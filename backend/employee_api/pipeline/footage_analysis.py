"""Footage analysis through the existing pipeline's `restaurant_vision.observe`:
RF-DETR person detection, ByteTrack tracking, InsightFace face embedding and
identity resolution against a gallery -- exactly as the existing backend runs
it. The gallery is built the same way the existing backend builds it
(`<dir>/emp_<uuid7>/sample.<ext>` + `labels.json`), from the registered faces
of active employees. The pipeline's identity decisions are then turned into
IN/OUT events by `services/events.py`."""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, storage
from ..config import get_settings
from ..ids import parse_pipeline_id, pipeline_id, uuid7
from ..models import Employee, FaceRegistration, FootageRecording
from ..services.events import Detection, record_detection
from ..services.rules import load_rules
from .bridge import PipelineUnavailable, run_module

log = logging.getLogger("employee_api.footage_analysis")

FAILURE_MESSAGES = {
    "gallery_empty": "No active employee has a registered face, so nobody could be recognised in this footage. Register faces, then analyse the footage again.",
    "pipeline_unavailable": "The footage could not be analysed because the recognition pipeline is unavailable.",
    "pipeline_error": "The recognition pipeline stopped with an error while analysing this footage.",
    "footage_missing": "The uploaded footage file is missing from storage. Upload it again.",
    "camera_disabled": "The camera was disabled before analysis started. Enable the camera and analyse the footage again.",
}


def _build_gallery(db: Session) -> tuple[Path | None, int]:
    # Every registered pose (front, and left/right when present) of active employees whose
    # front face is registered; the pipeline enrols all images in an employee's folder.
    rows = db.execute(
        select(Employee, FaceRegistration)
        .join(FaceRegistration, FaceRegistration.employee_id == Employee.id)
        .where(Employee.status == "active", Employee.active_registration_id.is_not(None),
               FaceRegistration.status == "registered")
    ).all()
    tmp = Path(tempfile.mkdtemp(prefix="ems-gallery-"))
    labels: dict[str, str] = {}
    for employee, reg in rows:
        if not reg.image_path:
            continue
        src = storage.resolve(reg.image_path)
        if not src.exists():
            log.warning("registered %s face image missing for employee %s", reg.pose_slot, employee.id)
            continue
        emp_key = pipeline_id("employee", employee.id)
        (tmp / emp_key).mkdir(exist_ok=True)
        shutil.copy(src, tmp / emp_key / f"{reg.pose_slot}{src.suffix}")
        labels[emp_key] = employee.full_name
    if not labels:
        shutil.rmtree(tmp, ignore_errors=True)
        return None, 0
    (tmp / "labels.json").write_text(json.dumps(labels))
    return tmp, len(labels)


def _fail(db: Session, recording: FootageRecording, code: str, detail: str | None = None) -> None:
    recording.status = "failed"
    recording.failure_code = code
    recording.failure_detail = detail
    recording.completed_at = datetime.now(timezone.utc)
    audit.record(db, None, "footage.analysis_failed", "camera", recording.camera_id,
                 f"Analysis of {recording.original_filename} failed: {code}", {"recordingId": str(recording.id)})


def _confidence(decision: dict, employee_key: str) -> float | None:
    for cand in decision.get("candidates") or []:
        if cand.get("employeeId") == employee_key:
            values = [v for v in (cand.get("bestFrameSimilarity"), cand.get("pooledSimilarity")) if v is not None]
            return round(max(values), 4) if values else None
    return None


def process(db: Session, recording_id: uuid.UUID) -> None:
    recording = db.get(FootageRecording, recording_id)
    if recording is None or recording.status not in ("queued", "processing"):
        return
    camera = recording.camera
    recording.status = "processing"
    recording.processing_started_at = datetime.now(timezone.utc)
    db.commit()

    if not camera.enabled:
        _fail(db, recording, "camera_disabled")
        return
    video = storage.resolve(recording.storage_path)
    if not video.exists():
        _fail(db, recording, "footage_missing")
        return
    gallery_dir, gallery_size = _build_gallery(db)
    recording.gallery_employee_count = gallery_size
    if gallery_dir is None:
        _fail(db, recording, "gallery_empty")
        return

    run_key = f"runs/{recording.id}"
    out_dir = storage.resolve(run_key)
    out_dir.mkdir(parents=True, exist_ok=True)
    args = [
        "--video", str(video),
        "--camera-id", pipeline_id("camera", camera.id),
        "--recording-id", pipeline_id("recording", recording.id),
        "--run-id", pipeline_id("run", recording.id),
        "--out", str(out_dir),
        "--gallery", str(gallery_dir),
        "--gallery-version-id", pipeline_id("gallery", uuid7()),
        "--resume",
    ]
    try:
        proc = run_module("restaurant_vision.observe", args, timeout=get_settings().footage_analysis_timeout_s)
    except PipelineUnavailable as exc:
        _fail(db, recording, "pipeline_unavailable", str(exc))
        return
    except subprocess.TimeoutExpired:
        _fail(db, recording, "pipeline_error", "Analysis did not finish within the configured timeout.")
        return
    finally:
        shutil.rmtree(gallery_dir, ignore_errors=True)

    result_path = out_dir / "run_result.json"
    if proc.returncode != 0 or not result_path.exists():
        detail = (proc.stderr or "").strip()[-600:] or f"exit code {proc.returncode}"
        log.error("observe failed for recording %s: %s", recording.id, detail)
        _fail(db, recording, "pipeline_unavailable" if proc.returncode == 3 else "pipeline_error", detail)
        return

    run_result = json.loads(result_path.read_text())
    recording.duration_ms = (run_result.get("media") or {}).get("durationMs")
    summaries = json.loads((out_dir / "track_summaries.json").read_text())
    decisions = json.loads((out_dir / "identity_decisions.json").read_text())
    segments = {
        seg["trackSegmentId"]: seg
        for summary in summaries
        for seg in summary.get("segments") or []
    }

    rules = load_rules(db).attendance
    detections: list[Detection] = []
    for decision in decisions:
        status = decision.get("status")
        employee_key = decision.get("employeeId")
        needs_review = False
        if status == "review" and rules.review_decision_handling == "queue_for_review":
            candidates = decision.get("candidates") or []
            employee_key = employee_key or (candidates[0].get("employeeId") if candidates else None)
            needs_review = True
        elif status != "auto":
            continue
        employee_uuid = parse_pipeline_id("employee", employee_key)
        segment = segments.get(decision.get("trackSegmentId"))
        employee = db.get(Employee, employee_uuid) if employee_uuid else None
        if employee is None or segment is None:
            continue
        start_ms, end_ms = int(segment["startSourceMs"]), int(segment["endSourceMs"])
        detections.append(Detection(
            employee=employee,
            first_seen=recording.capture_started_at + timedelta(milliseconds=start_ms),
            last_seen=recording.capture_started_at + timedelta(milliseconds=end_ms),
            first_offset_ms=start_ms,
            last_offset_ms=end_ms,
            confidence=_confidence(decision, employee_key),
            needs_review=needs_review,
            decision_method=decision.get("method"),
            identity_decision_id=decision.get("identityDecisionId"),
            track_segment_id=decision["trackSegmentId"],
        ))

    counts = {"confirmed": 0, "needs_review": 0, "other": 0}
    for det in sorted(detections, key=lambda d: d.first_seen):
        event = record_detection(db, rules, camera, recording, det)
        if event is None:
            continue
        key = event.status if event.status in ("confirmed", "needs_review") else "other"
        counts[key] += 1

    recording.identity_decisions = len(decisions)
    recording.events_confirmed = counts["confirmed"]
    recording.events_needs_review = counts["needs_review"]
    recording.events_other = counts["other"]
    recording.status = "completed"
    recording.failure_code = None
    recording.failure_detail = None
    recording.completed_at = datetime.now(timezone.utc)
    audit.record(db, None, "footage.analysed", "camera", camera.id,
                 f"Analysed {recording.original_filename}: {counts['confirmed']} confirmed, {counts['needs_review']} for review",
                 {"recordingId": str(recording.id), **counts})
