"""PostgreSQL job queue for work that runs the recognition pipeline. The API
enqueues; `employee_api.worker` claims with `FOR UPDATE SKIP LOCKED` under a
lease, so a crashed worker's job is picked up again after the lease expires."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import Job

FACE_REGISTRATION = "face.register"
FOOTAGE_ANALYSIS = "footage.analyse"


def enqueue(db: Session, kind: str, payload: dict, *, max_attempts: int = 2) -> Job:
    job = Job(kind=kind, payload=payload, max_attempts=max_attempts, status="queued")
    db.add(job)
    db.flush()
    return job


def claim(db: Session, lease_seconds: int) -> Job | None:
    now = datetime.now(timezone.utc)
    job = db.scalar(
        select(Job)
        .where(or_(Job.status == "queued", (Job.status == "running") & (Job.lease_expires_at < now)))
        .where(Job.attempts < Job.max_attempts)
        .order_by(Job.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if job is None:
        return None
    job.status = "running"
    job.attempts += 1
    job.started_at = now
    job.lease_expires_at = now + timedelta(seconds=lease_seconds)
    db.commit()
    return job


def finish(db: Session, job_id: uuid.UUID, *, error_code: str | None = None, error_message: str | None = None) -> None:
    job = db.get(Job, job_id)
    if job is None:
        return
    job.status = "failed" if error_code else "succeeded"
    job.error_code = error_code
    job.error_message = error_message
    job.finished_at = datetime.now(timezone.utc)
    job.lease_expires_at = None


def expired_exhausted(db: Session) -> list[Job]:
    """Running jobs whose lease expired with no attempts left: their worker died."""
    now = datetime.now(timezone.utc)
    return list(
        db.scalars(
            select(Job)
            .where(Job.status == "running", Job.lease_expires_at < now, Job.attempts >= Job.max_attempts)
            .with_for_update(skip_locked=True)
        )
    )
