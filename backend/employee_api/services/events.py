"""Turns identified employee presences into IN/OUT recognition events.

Input is one identity decision of the existing pipeline: an employee matched
on a track segment of one camera, with the segment's first and last seen
times. The camera's configured direction decides the event:

* Entry camera        -> IN at the time the employee was first seen.
* Exit camera         -> OUT at the time the employee was last seen.
* Entry & Exit camera -> OUT at last seen if the employee's latest confirmed
  event is an IN within the maximum session length, otherwise IN at first seen.

Camera directions are a global configuration: every active employee with a
registered face is recognised on every enabled camera, and the camera alone
decides whether a sighting is an IN or an OUT.

The event is then checked against the attendance rules in order: pipeline
review decisions stay `needs_review`; a confirmed event of the same type
within the minimum event interval gives `duplicate`. Everything else is
`confirmed`. Only confirmed events count for attendance."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Camera, Employee, FootageRecording, RecognitionEvent
from .rules import AttendanceRules


@dataclass(frozen=True)
class Detection:
    employee: Employee
    first_seen: datetime
    last_seen: datetime
    first_offset_ms: int
    last_offset_ms: int
    confidence: float | None
    needs_review: bool
    decision_method: str | None
    identity_decision_id: str | None
    track_segment_id: str


def _latest_confirmed(db: Session, employee_id, before: datetime) -> RecognitionEvent | None:
    return db.scalar(
        select(RecognitionEvent)
        .where(RecognitionEvent.employee_id == employee_id, RecognitionEvent.status == "confirmed",
               RecognitionEvent.occurred_at <= before)
        .order_by(RecognitionEvent.occurred_at.desc())
        .limit(1)
    )


def event_type_for(db: Session, camera: Camera, det: Detection, rules: AttendanceRules) -> str:
    if camera.direction == "entry":
        return "in"
    if camera.direction == "exit":
        return "out"
    last = _latest_confirmed(db, det.employee.id, det.first_seen)
    open_session = (
        last is not None and last.event_type == "in"
        and det.first_seen - last.occurred_at <= timedelta(hours=rules.max_session_hours)
    )
    return "out" if open_session else "in"


def _has_recent(db: Session, employee_id, event_type: str, at: datetime, minutes: int) -> bool:
    if minutes <= 0:
        return False
    window = timedelta(minutes=minutes)
    return db.scalar(
        select(RecognitionEvent.id).where(
            RecognitionEvent.employee_id == employee_id,
            RecognitionEvent.event_type == event_type,
            RecognitionEvent.status == "confirmed",
            RecognitionEvent.occurred_at >= at - window,
            RecognitionEvent.occurred_at <= at + window,
        ).limit(1)
    ) is not None


def record_detection(
    db: Session, rules: AttendanceRules, camera: Camera, recording: FootageRecording, det: Detection
) -> RecognitionEvent | None:
    """Creates the event for one detection; None if this segment was already recorded."""
    exists = db.scalar(
        select(RecognitionEvent.id).where(
            RecognitionEvent.recording_id == recording.id, RecognitionEvent.track_segment_id == det.track_segment_id
        )
    )
    if exists is not None:
        return None
    event_type = event_type_for(db, camera, det, rules)
    occurred_at = det.first_seen if event_type == "in" else det.last_seen
    offset = det.first_offset_ms if event_type == "in" else det.last_offset_ms
    if det.needs_review:
        status = "needs_review"
    elif _has_recent(db, det.employee.id, event_type, occurred_at, rules.min_event_interval_minutes):
        status = "duplicate"
    else:
        status = "confirmed"
    event = RecognitionEvent(
        employee_id=det.employee.id,
        camera_id=camera.id,
        recording_id=recording.id,
        event_type=event_type,
        occurred_at=occurred_at,
        confidence=det.confidence,
        source="footage_analysis",
        status=status,
        decision_method=det.decision_method,
        identity_decision_id=det.identity_decision_id,
        track_segment_id=det.track_segment_id,
        source_offset_ms=offset,
    )
    db.add(event)
    db.flush()
    return event
