"""Recognition worker: `python -m employee_api.worker`.

Claims queued jobs and runs them through the existing pipeline. Run exactly
one worker per GPU host; the existing pipeline is designed for one GPU job at
a time on the shared GPU."""
from __future__ import annotations

import logging
import signal
import time
import uuid
from datetime import datetime, timezone

from . import jobs
from .config import get_settings
from .db import new_session
from .models import Employee, FaceRegistration, FootageRecording, Job
from .pipeline import face_registration, footage_analysis

log = logging.getLogger("employee_api.worker")

_stop = False


def _request_stop(*_):
    global _stop
    _stop = True
    log.info("stop requested; finishing the current job first")


def _dispatch(db, job: Job) -> None:
    target = uuid.UUID(job.payload["targetId"])
    if job.kind == jobs.FACE_REGISTRATION:
        face_registration.process(db, target)
    elif job.kind == jobs.FOOTAGE_ANALYSIS:
        footage_analysis.process(db, target)
    else:
        raise ValueError(f"unknown job kind {job.kind}")


def _mark_target_failed(db, job: Job, detail: str) -> None:
    target = uuid.UUID(job.payload["targetId"])
    now = datetime.now(timezone.utc)
    if job.kind == jobs.FACE_REGISTRATION:
        reg = db.get(FaceRegistration, target)
        if reg is not None and reg.status == "processing":
            reg.status, reg.failure_reason, reg.failure_detail, reg.completed_at = "failed", "pipeline_error", detail, now
            employee = db.get(Employee, reg.employee_id)
            if employee is not None and reg.pose_slot == "front":
                employee.face_status = "registered" if employee.active_registration_id else "failed"
    elif job.kind == jobs.FOOTAGE_ANALYSIS:
        rec = db.get(FootageRecording, target)
        if rec is not None and rec.status in ("queued", "processing"):
            rec.status, rec.failure_code, rec.failure_detail, rec.completed_at = "failed", "pipeline_error", detail, now


def run_once() -> bool:
    """Processes at most one job. Returns True if a job was claimed."""
    settings = get_settings()
    with new_session() as db:
        for dead in jobs.expired_exhausted(db):
            detail = "The worker processing this job stopped before it finished."
            _mark_target_failed(db, dead, detail)
            jobs.finish(db, dead.id, error_code="worker_lost", error_message=detail)
        db.commit()

        job = jobs.claim(db, settings.job_lease_seconds)
        if job is None:
            return False
        log.info("running %s job %s (attempt %d)", job.kind, job.id, job.attempts)
        try:
            _dispatch(db, job)
            jobs.finish(db, job.id)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - a job failure must not stop the worker
            db.rollback()
            log.exception("job %s failed", job.id)
            job = db.get(Job, job.id)
            if job.attempts >= job.max_attempts:
                _mark_target_failed(db, job, f"{type(exc).__name__}: {exc}"[:600])
                jobs.finish(db, job.id, error_code="internal", error_message=str(exc)[:600])
            else:
                job.status = "queued"
                job.lease_expires_at = None
            db.commit()
        return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    signal.signal(signal.SIGINT, _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)
    poll = get_settings().worker_poll_seconds
    log.info("recognition worker started")
    while not _stop:
        if not run_once():
            time.sleep(poll)
    log.info("recognition worker stopped")


if __name__ == "__main__":
    main()
