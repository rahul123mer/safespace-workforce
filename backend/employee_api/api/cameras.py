from __future__ import annotations

import json
import subprocess
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import audit, serializers
from ..config import get_settings
from ..db import get_db
from ..deps import Principal, require
from ..errors import conflict, invalid, not_found
from ..models import Camera
from ..schemas import CameraBody, CameraEnabledBody, CameraUpdateBody

router = APIRouter(prefix="/cameras", tags=["cameras"])

STATUSES = ("online", "offline", "not_verified", "configuration_required", "disabled")


def _get(db: Session, camera_id: uuid.UUID) -> Camera:
    camera = db.get(Camera, camera_id)
    if camera is None:
        raise not_found("camera")
    return camera


def _serialize(db: Session, cameras: list[Camera], principal: Principal) -> list[dict]:
    ids = [c.id for c in cameras]
    last = serializers.camera_last_events(db, ids)
    show_source = principal.can("cameras.view_source")
    return [serializers.camera(c, last.get(c.id), show_source=show_source) for c in cameras]


def _check_code(db: Session, code: str, exclude: uuid.UUID | None = None) -> None:
    q = select(Camera.id).where(func.lower(Camera.camera_code) == code.lower())
    if exclude:
        q = q.where(Camera.id != exclude)
    if db.scalar(q):
        raise conflict("duplicate_camera", "Another camera already uses this Camera ID.", {"cameraCode": "Another camera already uses this Camera ID."})


def _snapshot(c: Camera) -> dict:
    return {"cameraCode": c.camera_code, "name": c.name, "location": c.location, "cameraType": c.camera_type,
            "direction": c.direction, "sourceUrl": "configured" if c.source_url else None, "enabled": c.enabled}


@router.get("")
def list_cameras(
    search: str | None = Query(default=None, max_length=100),
    direction: str | None = Query(default=None, pattern="^(entry|exit|entry_exit)$"),
    status: str | None = Query(default=None),
    principal: Principal = Depends(require("cameras.view")),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Camera).order_by(Camera.name)
    if search and search.strip():
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(Camera.name.ilike(like), Camera.camera_code.ilike(like), Camera.location.ilike(like)))
    if direction:
        stmt = stmt.where(Camera.direction == direction)
    items = _serialize(db, list(db.scalars(stmt)), principal)
    if status:
        if status not in STATUSES:
            raise invalid("Choose a valid camera status.")
        items = [i for i in items if i["status"] == status]
    return {"items": items}


@router.post("", status_code=201)
def create_camera(body: CameraBody, principal: Principal = Depends(require("cameras.manage")), db: Session = Depends(get_db)) -> dict:
    _check_code(db, body.camera_code)
    camera = Camera(camera_code=body.camera_code, name=body.name, location=body.location, camera_type=body.camera_type,
                    direction=body.direction, source_url=body.source_url, enabled=True, connection_status="not_verified")
    db.add(camera)
    db.flush()
    audit.record(db, principal, "camera.created", "camera", camera.id, f"Added camera {camera.name} ({camera.camera_code})", _snapshot(camera))
    db.commit()
    return _serialize(db, [camera], principal)[0]


@router.get("/{camera_id}")
def get_camera(camera_id: uuid.UUID, principal: Principal = Depends(require("cameras.view")), db: Session = Depends(get_db)) -> dict:
    return _serialize(db, [_get(db, camera_id)], principal)[0]


@router.patch("/{camera_id}")
def update_camera(camera_id: uuid.UUID, body: CameraUpdateBody, principal: Principal = Depends(require("cameras.manage")),
                  db: Session = Depends(get_db)) -> dict:
    camera = _get(db, camera_id)
    _check_code(db, body.camera_code, exclude=camera.id)
    before = _snapshot(camera)
    camera.camera_code, camera.name, camera.location = body.camera_code, body.name, body.location
    camera.camera_type, camera.direction = body.camera_type, body.direction
    if body.replace_source and body.source_url != camera.source_url:
        camera.source_url = body.source_url
        camera.connection_status = "not_verified"
        camera.last_checked_at = None
        camera.last_check_message = None
    changes = audit.diff(before, _snapshot(camera))
    if body.replace_source and "sourceUrl" not in changes:
        changes["sourceUrl"] = "changed"
    if changes:
        audit.record(db, principal, "camera.updated", "camera", camera.id, f"Updated camera {camera.name}", changes)
    db.commit()
    return _serialize(db, [camera], principal)[0]


@router.post("/{camera_id}/enabled")
def set_enabled(camera_id: uuid.UUID, body: CameraEnabledBody, principal: Principal = Depends(require("cameras.manage")),
                db: Session = Depends(get_db)) -> dict:
    camera = _get(db, camera_id)
    if camera.enabled != body.enabled:
        camera.enabled = body.enabled
        audit.record(db, principal, "camera.enabled" if body.enabled else "camera.disabled", "camera", camera.id,
                     f"{'Enabled' if body.enabled else 'Disabled'} camera {camera.name}")
        db.commit()
    return _serialize(db, [camera], principal)[0]


def _probe(url: str) -> tuple[str, str]:
    """ffprobe the stream once. Returns (connection_status, message)."""
    cmd = [get_settings().ffprobe_path, "-v", "error", "-show_entries", "stream=codec_type,width,height",
           "-of", "json", "-timeout", "10000000"]
    if url.lower().startswith("rtsp"):
        cmd += ["-rtsp_transport", "tcp"]
    try:
        proc = subprocess.run([*cmd, "-i", url], capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        raise invalid("The connection could not be checked because ffprobe is not installed on the server. Install FFmpeg or set EMS_FFPROBE_PATH.") from None
    except subprocess.TimeoutExpired:
        return "offline", "The camera did not respond within 20 seconds."
    if proc.returncode != 0:
        return "offline", "The stream could not be opened. Verify the address, credentials and network access."
    try:
        streams = json.loads(proc.stdout or "{}").get("streams") or []
    except ValueError:
        streams = []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        return "offline", "The stream opened but contains no video."
    return "online", f"Video stream available ({video.get('width')}×{video.get('height')})."


@router.post("/{camera_id}/connection-check")
def check_connection(camera_id: uuid.UUID, principal: Principal = Depends(require("cameras.manage")),
                     db: Session = Depends(get_db)) -> dict:
    camera = _get(db, camera_id)
    if not camera.source_url:
        raise invalid("No stream address is configured for this camera. Add one before checking the connection.")
    status, message = _probe(camera.source_url)
    camera.connection_status = status
    camera.last_check_message = message
    camera.last_checked_at = datetime.now(timezone.utc)
    audit.record(db, principal, "camera.connection_checked", "camera", camera.id, f"Connection check of {camera.name}: {status}")
    db.commit()
    return _serialize(db, [camera], principal)[0]

