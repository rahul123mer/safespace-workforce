"""Attendance sessions from confirmed IN/OUT events.

Events of one employee are walked in time order. An IN opens a session; the
next OUT within `maxSessionHours` closes it. An IN while a session is open
leaves the earlier session without an exit. An OUT with no open session
becomes a session without an entry. Nothing is ever inferred: a missing IN or
OUT stays missing. A session belongs to the site-local date of its IN (or of
its OUT when there is no IN), so night shifts that cross midnight stay one row."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Camera, Employee, RecognitionEvent, Shift
from .rules import SystemRules


@dataclass
class AttendanceSession:
    employee: Employee
    work_date: date
    in_event: RecognitionEvent | None
    out_event: RecognitionEvent | None
    status: str
    late_minutes: int | None


def day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def late_minutes(shift: Shift | None, in_at: datetime, tz: ZoneInfo) -> int | None:
    """Minutes after shift start plus grace, or None when on time / no shift."""
    if shift is None or shift.status != "active":
        return None
    local = in_at.astimezone(tz)
    scheduled = datetime.combine(local.date(), shift.start_time, tzinfo=tz)
    # An arrival more than 12 h before the start on the same date belongs to the previous day's shift.
    if local < scheduled - timedelta(hours=12):
        scheduled -= timedelta(days=1)
    late = (local - (scheduled + timedelta(minutes=shift.grace_period_minutes))).total_seconds() / 60
    return int(late) if late >= 1 else None


def build_sessions(events: list[RecognitionEvent], rules: SystemRules, now: datetime) -> list[AttendanceSession]:
    tz = rules.tz
    max_len = timedelta(hours=rules.attendance.max_session_hours)
    sessions: list[AttendanceSession] = []
    by_employee: dict[uuid.UUID, list[RecognitionEvent]] = {}
    for ev in events:
        by_employee.setdefault(ev.employee_id, []).append(ev)

    for evs in by_employee.values():
        evs.sort(key=lambda e: e.occurred_at)
        employee = evs[0].employee
        open_in: RecognitionEvent | None = None

        def close(in_ev: RecognitionEvent | None, out_ev: RecognitionEvent | None) -> None:
            anchor = in_ev or out_ev
            if in_ev and out_ev:
                status = "completed"
            elif in_ev:
                status = "inside" if now - in_ev.occurred_at <= max_len else "exit_not_recorded"
            else:
                status = "entry_not_recorded"
            sessions.append(AttendanceSession(
                employee=employee,
                work_date=anchor.occurred_at.astimezone(tz).date(),
                in_event=in_ev,
                out_event=out_ev,
                status=status,
                late_minutes=late_minutes(employee.shift, in_ev.occurred_at, tz) if in_ev else None,
            ))

        for ev in evs:
            if ev.event_type == "in":
                if open_in is not None:
                    close(open_in, None)
                open_in = ev
            elif open_in is not None and ev.occurred_at - open_in.occurred_at <= max_len:
                close(open_in, ev)
                open_in = None
            else:
                if open_in is not None:
                    close(open_in, None)
                    open_in = None
                close(None, ev)
        if open_in is not None:
            close(open_in, None)
    return sessions


def sessions_between(
    db: Session,
    rules: SystemRules,
    date_from: date,
    date_to: date,
    *,
    employee_ids: list[uuid.UUID] | None = None,
) -> list[AttendanceSession]:
    tz = rules.tz
    pad = timedelta(hours=rules.attendance.max_session_hours)
    start, _ = day_bounds(date_from, tz)
    _, end = day_bounds(date_to, tz)
    stmt = select(RecognitionEvent).where(
        RecognitionEvent.status == "confirmed",
        RecognitionEvent.occurred_at >= start - pad,
        RecognitionEvent.occurred_at < end + pad,
    )
    if employee_ids is not None:
        stmt = stmt.where(RecognitionEvent.employee_id.in_(employee_ids))
    events = list(db.scalars(stmt))
    sessions = build_sessions(events, rules, datetime.now(timezone.utc))
    rows = [s for s in sessions if date_from <= s.work_date <= date_to]
    rows.sort(key=lambda s: (s.work_date, (s.in_event or s.out_event).occurred_at), reverse=True)
    return rows


def presence(db: Session, rules: SystemRules) -> dict[uuid.UUID, RecognitionEvent]:
    """Latest confirmed event per employee (used for Currently In / Out)."""
    latest: dict[uuid.UUID, RecognitionEvent] = {}
    for ev in db.scalars(
        select(RecognitionEvent)
        .distinct(RecognitionEvent.employee_id)
        .where(RecognitionEvent.status == "confirmed")
        .order_by(RecognitionEvent.employee_id, RecognitionEvent.occurred_at.desc())
    ):
        latest[ev.employee_id] = ev
    return latest


def is_inside(event: RecognitionEvent | None, rules: SystemRules, now: datetime) -> bool:
    return (
        event is not None and event.event_type == "in"
        and now - event.occurred_at <= timedelta(hours=rules.attendance.max_session_hours)
    )


def camera_brief(camera: Camera | None) -> dict | None:
    if camera is None:
        return None
    return {"id": str(camera.id), "name": camera.name, "location": camera.location, "code": camera.camera_code}
