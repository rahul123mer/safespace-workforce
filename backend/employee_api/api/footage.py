"""Camera footage imports. Each file is analysed by the existing recognition
pipeline in the worker; its capture start time anchors every event it yields."""
from __future__ import annotations

import hashlib
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, jobs, serializers, storage
from ..config import get_settings
from ..db import get_db
from ..deps import Principal, require
from ..errors import ApiError, conflict, invalid, not_found
from ..models import Camera, FootageRecording
from ..services.rules import load_rules

router = APIRouter(tags=["footage"])

VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".avi", ".m4v"}


def _looks_like_video(head: bytes) -> bool:
    return (
        head[4:8] == b"ftyp"                                   # MP4 / MOV / M4V
        or head[:4] == b"\x1a\x45\xdf\xa3"                     # Matroska
        or (head[:4] == b"RIFF" and head[8:12] == b"AVI ")     # AVI
    )


@router.get("/footage")
def list_footage(
    camera_id: uuid.UUID | None = Query(default=None, alias="cameraId"),
    status: str | None = Query(default=None, pattern="^(queued|processing|completed|failed)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    _: Principal = Depends(require("footage.view")),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(FootageRecording)
    if camera_id:
        stmt = stmt.where(FootageRecording.camera_id == camera_id)
    if status:
        stmt = stmt.where(FootageRecording.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(FootageRecording.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"items": [serializers.footage(r) for r in rows], "total": total, "page": page, "pageSize": page_size}


@router.post("/cameras/{camera_id}/footage", status_code=202)
def upload_footage(
    camera_id: uuid.UUID,
    file: UploadFile = File(...),
    capture_started_at: str = Form(alias="captureStartedAt"),
    principal: Principal = Depends(require("footage.manage")),
    db: Session = Depends(get_db),
) -> dict:
    camera = db.get(Camera, camera_id)
    if camera is None:
        raise not_found("camera")
    if not camera.enabled:
        raise conflict("camera_disabled", "This camera is disabled. Enable it before importing footage.")
    rules = load_rules(db)
    try:
        local = datetime.fromisoformat(capture_started_at)
    except ValueError:
        raise invalid("Enter the date and time of the first frame.", {"captureStartedAt": "Enter a valid date and time."}) from None
    started = (local.replace(tzinfo=rules.tz) if local.tzinfo is None else local).astimezone(timezone.utc)
    if started > datetime.now(timezone.utc):
        raise invalid("The capture start time is in the future.", {"captureStartedAt": "The first frame cannot be in the future."})

    name = Path(file.filename or "footage").name[:255]
    suffix = Path(name).suffix.lower()
    if suffix not in VIDEO_SUFFIXES:
        raise ApiError(415, "unsupported_file_type", "Unsupported file type. Import an MP4, MOV, MKV or AVI camera export.")
    head = file.file.read(16)
    if not _looks_like_video(head):
        raise ApiError(415, "unsupported_file_type", "The file is not a recognised video container. Import an MP4, MOV, MKV or AVI camera export.")
    file.file.seek(0)

    rec = FootageRecording(camera_id=camera.id, original_filename=name, storage_path="", size_bytes=0, content_sha256="",
                           capture_started_at=started, status="queued", uploaded_by=principal.user.id)
    db.add(rec)
    db.flush()
    rec.storage_path = f"footage/{camera.id}/{rec.id}{suffix}"
    target = storage.resolve(rec.storage_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    limit = get_settings().max_footage_bytes
    digest, size = hashlib.sha256(), 0
    try:
        with open(target, "wb") as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise ApiError(413, "footage_too_large", f"The file is larger than {limit // (1024 ** 3)} GB. Split the export into shorter files.")
                digest.update(chunk)
                out.write(chunk)
    except BaseException:
        db.rollback()
        target.unlink(missing_ok=True)
        raise
    rec.size_bytes = size
    rec.content_sha256 = digest.hexdigest()
    duplicate = db.scalar(select(FootageRecording).where(
        FootageRecording.camera_id == camera.id, FootageRecording.content_sha256 == rec.content_sha256,
        FootageRecording.id != rec.id, FootageRecording.status != "failed"))
    if duplicate is not None:
        db.rollback()
        target.unlink(missing_ok=True)
        raise conflict("duplicate_footage", f"This file was already imported for {camera.name} as {duplicate.original_filename}.")
    jobs.enqueue(db, jobs.FOOTAGE_ANALYSIS, {"targetId": str(rec.id)}, max_attempts=2)
    audit.record(db, principal, "footage.imported", "camera", camera.id, f"Imported {name} for {camera.name}",
                 {"recordingId": str(rec.id), "sizeBytes": size, "captureStartedAt": started.isoformat()})
    db.commit()
    return serializers.footage(rec)


@router.get("/footage/{recording_id}")
def get_footage(recording_id: uuid.UUID, _: Principal = Depends(require("footage.view")), db: Session = Depends(get_db)) -> dict:
    rec = db.get(FootageRecording, recording_id)
    if rec is None:
        raise not_found("footage import")
    return serializers.footage(rec)


@router.post("/footage/{recording_id}/retry", status_code=202)
def retry_footage(recording_id: uuid.UUID, principal: Principal = Depends(require("footage.manage")),
                  db: Session = Depends(get_db)) -> dict:
    rec = db.get(FootageRecording, recording_id)
    if rec is None:
        raise not_found("footage import")
    if rec.status != "failed":
        raise conflict("not_failed", "Only a failed analysis can be started again.")
    if not storage.resolve(rec.storage_path).exists():
        raise conflict("footage_missing", "The footage file is no longer in storage. Import it again.")
    shutil.rmtree(storage.resolve(f"runs/{rec.id}"), ignore_errors=True)
    rec.status = "queued"
    rec.failure_code = rec.failure_detail = None
    rec.processing_started_at = rec.completed_at = None
    jobs.enqueue(db, jobs.FOOTAGE_ANALYSIS, {"targetId": str(rec.id)}, max_attempts=2)
    audit.record(db, principal, "footage.retried", "camera", rec.camera_id, f"Restarted analysis of {rec.original_filename}")
    db.commit()
    return serializers.footage(rec)
