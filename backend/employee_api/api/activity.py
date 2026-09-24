"""Recognition events, attendance sessions and the dashboard summary."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, serializers
from ..db import get_db
from ..deps import Principal, require
from ..errors import conflict, invalid, not_found
from ..models import Camera, Employee, FaceRegistration, FootageRecording, RecognitionEvent, Shift
from ..pipeline.status import model_fingerprint
from ..schemas import EventReviewBody
from ..services import attendance
from ..services.rules import load_rules

router = APIRouter(tags=["activity"])

EVENT_STATUSES = ("confirmed", "needs_review", "rejected", "duplicate")


def _range(date_from: date | None, date_to: date | None, today: date) -> tuple[date, date]:
    date_from = date_from or date_to or today
    date_to = date_to or date_from
    if date_to < date_from:
        raise invalid("The end date is before the start date.", {"dateTo": "Choose a date on or after the start date."})
    if (date_to - date_from).days > 92:
        raise invalid("Choose a period of at most 93 days.", {"dateTo": "Choose a period of at most 93 days."})
    return date_from, date_to


def _uuid(value: str | None, field: str) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise invalid("Choose a valid value.", {field: "Choose a valid value."}) from None


@router.get("/events")
def list_events(
    date_from: date | None = Query(default=None, alias="dateFrom"),
    date_to: date | None = Query(default=None, alias="dateTo"),
    employee_id: str | None = Query(default=None, alias="employeeId"),
    camera_id: str | None = Query(default=None, alias="cameraId"),
    event_type: str | None = Query(default=None, alias="eventType", pattern="^(in|out)$"),
    status: str | None = Query(default=None),
    department: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    _: Principal = Depends(require("events.view")),
    db: Session = Depends(get_db),
) -> dict:
    rules = load_rules(db)
    today = datetime.now(rules.tz).date()
    date_from, date_to = _range(date_from, date_to, today)
    start, _e = attendance.day_bounds(date_from, rules.tz)
    _s, end = attendance.day_bounds(date_to, rules.tz)
    stmt = select(RecognitionEvent).where(RecognitionEvent.occurred_at >= start, RecognitionEvent.occurred_at < end)
    if (emp := _uuid(employee_id, "employeeId")) is not None:
        stmt = stmt.where(RecognitionEvent.employee_id == emp)
    if (cam := _uuid(camera_id, "cameraId")) is not None:
        stmt = stmt.where(RecognitionEvent.camera_id == cam)
    if event_type:
        stmt = stmt.where(RecognitionEvent.event_type == event_type)
    if department:
        stmt = stmt.where(RecognitionEvent.employee_id.in_(select(Employee.id).where(Employee.department == department)))
    by_status = stmt.subquery()
    counts = dict(db.execute(select(by_status.c.status, func.count()).group_by(by_status.c.status)).all())
    if status:
        if status not in EVENT_STATUSES:
            raise invalid("Choose a valid recognition status.")
        stmt = stmt.where(RecognitionEvent.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(RecognitionEvent.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size))
    return {
        "items": [serializers.event(e) for e in rows],
        "total": total, "page": page, "pageSize": page_size,
        "statusCounts": {s: counts.get(s, 0) for s in EVENT_STATUSES},
        "dateFrom": date_from.isoformat(), "dateTo": date_to.isoformat(),
    }


@router.post("/events/{event_id}/review")
def review_event(event_id: uuid.UUID, body: EventReviewBody, principal: Principal = Depends(require("events.review")),
                 db: Session = Depends(get_db)) -> dict:
    ev = db.get(RecognitionEvent, event_id)
    if ev is None:
        raise not_found("recognition event")
    if ev.status != "needs_review":
        raise conflict("not_reviewable", "Only events that need review can be reviewed.")
    previous = ev.status
    ev.status = "confirmed" if body.decision == "confirm" else "rejected"
    ev.reviewed_by = principal.user.id
    ev.reviewed_at = datetime.now(timezone.utc)
    audit.record(db, principal, f"event.{ev.status}", "employee", ev.employee_id,
                 f"{'Confirmed' if ev.status == 'confirmed' else 'Rejected'} {ev.event_type.upper()} event of {ev.employee.full_name} "
                 f"at {ev.camera.name}", {"eventId": str(ev.id), "status": {"from": previous, "to": ev.status}})
    db.commit()
    return serializers.event(ev)


def _session_row(s: attendance.AttendanceSession) -> dict:
    duration = None
    if s.in_event and s.out_event:
        duration = int((s.out_event.occurred_at - s.in_event.occurred_at).total_seconds() // 60)
    e = s.employee
    return {
        "employee": {"id": str(e.id), "employeeCode": e.employee_code, "fullName": e.full_name, "department": e.department,
                     "shift": serializers.shift_brief(e.shift)},
        "date": s.work_date.isoformat(),
        "inAt": serializers.iso(s.in_event.occurred_at) if s.in_event else None,
        "outAt": serializers.iso(s.out_event.occurred_at) if s.out_event else None,
        "durationMinutes": duration,
        "entryCamera": attendance.camera_brief(s.in_event.camera) if s.in_event else None,
        "exitCamera": attendance.camera_brief(s.out_event.camera) if s.out_event else None,
        "status": s.status,
        "lateMinutes": s.late_minutes,
    }


@router.get("/attendance")
def attendance_view(
    date_from: date | None = Query(default=None, alias="dateFrom"),
    date_to: date | None = Query(default=None, alias="dateTo"),
    employee_id: str | None = Query(default=None, alias="employeeId"),
    department: str | None = Query(default=None, max_length=80),
    shift_id: str | None = Query(default=None, alias="shiftId"),
    camera_id: str | None = Query(default=None, alias="cameraId"),
    event_type: str | None = Query(default=None, alias="eventType", pattern="^(in|out)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
    _: Principal = Depends(require("attendance.view")),
    db: Session = Depends(get_db),
) -> dict:
    rules = load_rules(db)
    date_from, date_to = _range(date_from, date_to, datetime.now(rules.tz).date())
    emp_stmt = select(Employee.id)
    filtered = False
    if (emp := _uuid(employee_id, "employeeId")) is not None:
        emp_stmt, filtered = emp_stmt.where(Employee.id == emp), True
    if department:
        emp_stmt, filtered = emp_stmt.where(Employee.department == department), True
    if (shift := _uuid(shift_id, "shiftId")) is not None:
        emp_stmt, filtered = emp_stmt.where(Employee.shift_id == shift), True
    employee_ids = list(db.scalars(emp_stmt)) if filtered else None
    rows = attendance.sessions_between(db, rules, date_from, date_to, employee_ids=employee_ids)
    cam = _uuid(camera_id, "cameraId")
    if cam is not None:
        rows = [r for r in rows if (r.in_event and r.in_event.camera_id == cam) or (r.out_event and r.out_event.camera_id == cam)]
    if event_type == "in":
        rows = [r for r in rows if r.in_event]
    elif event_type == "out":
        rows = [r for r in rows if r.out_event]
    summary = {
        "sessions": len(rows),
        "employees": len({r.employee.id for r in rows}),
        "late": sum(1 for r in rows if r.late_minutes),
        "exitNotRecorded": sum(1 for r in rows if r.status == "exit_not_recorded"),
        "entryNotRecorded": sum(1 for r in rows if r.status == "entry_not_recorded"),
        "inside": sum(1 for r in rows if r.status == "inside"),
    }
    start = (page - 1) * page_size
    return {"items": [_session_row(r) for r in rows[start:start + page_size]], "total": len(rows), "page": page,
            "pageSize": page_size, "summary": summary, "dateFrom": date_from.isoformat(), "dateTo": date_to.isoformat()}


@router.get("/dashboard")
def dashboard(_: Principal = Depends(require("dashboard.view")), db: Session = Depends(get_db)) -> dict:
    rules = load_rules(db)
    now = datetime.now(timezone.utc)
    today = now.astimezone(rules.tz).date()
    start, end = attendance.day_bounds(today, rules.tz)

    status_counts = dict(db.execute(select(Employee.status, func.count()).group_by(Employee.status)).all())
    active = status_counts.get("active", 0)
    fingerprint = model_fingerprint()
    face = {"registered": 0, "requires_reregistration": 0, "not_registered": 0, "processing": 0, "failed": 0}
    active_employees = db.scalars(select(Employee).where(Employee.status == "active")).all()
    regs = {r.id: r for r in db.scalars(select(FaceRegistration).where(
        FaceRegistration.id.in_([e.active_registration_id for e in active_employees if e.active_registration_id])))}
    for e in active_employees:
        face[serializers.effective_face_status(e, regs.get(e.active_registration_id), fingerprint)] += 1

    latest = attendance.presence(db, rules)
    inside_ids = [e.id for e in active_employees if attendance.is_inside(latest.get(e.id), rules, now)]
    out_count = sum(1 for e in active_employees if e.id in latest and latest[e.id].event_type == "out")
    inside_rows = sorted((latest[i] for i in inside_ids), key=lambda ev: ev.occurred_at, reverse=True)

    today_q = select(RecognitionEvent).where(RecognitionEvent.status == "confirmed", RecognitionEvent.occurred_at >= start,
                                             RecognitionEvent.occurred_at < end)
    today_events = list(db.scalars(today_q))
    recent = db.scalars(select(RecognitionEvent).order_by(RecognitionEvent.occurred_at.desc()).limit(8))
    pending_review = db.scalar(select(func.count()).select_from(RecognitionEvent).where(RecognitionEvent.status == "needs_review"))

    cameras = list(db.scalars(select(Camera).order_by(Camera.name)))
    last = serializers.camera_last_events(db, [c.id for c in cameras])
    camera_rows = [serializers.camera(c, last.get(c.id), show_source=False) for c in cameras]
    shift_counts = dict(db.execute(select(Employee.shift_id, func.count()).where(Employee.status == "active")
                                   .group_by(Employee.shift_id)).all())
    shifts = db.scalars(select(Shift).where(Shift.status == "active").order_by(Shift.start_time))
    footage_active = db.scalar(select(func.count()).select_from(FootageRecording).where(
        FootageRecording.status.in_(("queued", "processing"))))

    return {
        "date": today.isoformat(),
        "metrics": {
            "totalEmployees": sum(status_counts.values()),
            "activeEmployees": active,
            "inactiveEmployees": status_counts.get("inactive", 0),
            "faceRegistered": face["registered"],
            "faceRegistrationPending": face["not_registered"] + face["failed"] + face["requires_reregistration"] + face["processing"],
            "currentlyIn": len(inside_ids),
            "currentlyOut": out_count,
            "detectedToday": len({e.employee_id for e in today_events}),
            "entryEventsToday": sum(1 for e in today_events if e.event_type == "in"),
            "exitEventsToday": sum(1 for e in today_events if e.event_type == "out"),
            "configuredCameras": sum(1 for c in cameras if c.enabled),
            "camerasWithIssues": sum(1 for c in camera_rows if c["status"] in ("configuration_required", "offline")),
            "eventsNeedingReview": pending_review,
            "footageInProgress": footage_active,
        },
        "faceStatus": face,
        "recentEvents": [serializers.event(e) for e in recent],
        "currentlyInside": [
            {"employee": {"id": str(ev.employee.id), "fullName": ev.employee.full_name, "employeeCode": ev.employee.employee_code,
                          "department": ev.employee.department},
             "since": serializers.iso(ev.occurred_at), "camera": attendance.camera_brief(ev.camera)}
            for ev in inside_rows[:10]
        ],
        "cameras": camera_rows,
        "shifts": [serializers.shift(s, shift_counts.get(s.id, 0)) for s in shifts],
        "unassignedShiftEmployees": shift_counts.get(None, 0),
    }
