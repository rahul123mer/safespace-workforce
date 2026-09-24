from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .. import audit, serializers
from ..db import get_db
from ..deps import Principal, require
from ..errors import conflict, invalid, not_found
from ..models import Employee, Shift
from ..schemas import ShiftBody, ShiftEmployeesBody, StatusBody

router = APIRouter(prefix="/shifts", tags=["shifts"])


def _counts(db: Session) -> dict[uuid.UUID, int]:
    return dict(db.execute(
        select(Employee.shift_id, func.count()).where(Employee.shift_id.is_not(None), Employee.status == "active")
        .group_by(Employee.shift_id)
    ).all())


def _get(db: Session, shift_id: uuid.UUID) -> Shift:
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise not_found("shift")
    return shift


def _snapshot(s: Shift) -> dict:
    return {"name": s.name, "shiftType": s.shift_type, "startTime": serializers.hhmm(s.start_time),
            "endTime": serializers.hhmm(s.end_time), "gracePeriodMinutes": s.grace_period_minutes,
            "workingDays": list(s.working_days)}


def _check_name(db: Session, name: str, exclude: uuid.UUID | None = None) -> None:
    q = select(Shift.id).where(func.lower(Shift.name) == name.lower())
    if exclude:
        q = q.where(Shift.id != exclude)
    if db.scalar(q):
        raise conflict("duplicate_shift", "A shift with this name already exists.", {"name": "A shift with this name already exists."})


@router.get("")
def list_shifts(_: Principal = Depends(require("shifts.view")), db: Session = Depends(get_db)) -> dict:
    counts = _counts(db)
    shifts = db.scalars(select(Shift).order_by(Shift.status, Shift.start_time, Shift.name))
    return {"items": [serializers.shift(s, counts.get(s.id, 0)) for s in shifts]}


@router.post("", status_code=201)
def create_shift(body: ShiftBody, principal: Principal = Depends(require("shifts.manage")), db: Session = Depends(get_db)) -> dict:
    _check_name(db, body.name)
    shift = Shift(name=body.name, shift_type=body.shift_type, start_time=body.start_time, end_time=body.end_time,
                  grace_period_minutes=body.grace_period_minutes, working_days=body.working_days, status="active")
    db.add(shift)
    db.flush()
    audit.record(db, principal, "shift.created", "shift", shift.id, f"Created shift {shift.name}", _snapshot(shift))
    db.commit()
    return serializers.shift(shift, 0)


@router.patch("/{shift_id}")
def update_shift(shift_id: uuid.UUID, body: ShiftBody, principal: Principal = Depends(require("shifts.manage")),
                 db: Session = Depends(get_db)) -> dict:
    shift = _get(db, shift_id)
    _check_name(db, body.name, exclude=shift.id)
    before = _snapshot(shift)
    shift.name, shift.shift_type = body.name, body.shift_type
    shift.start_time, shift.end_time = body.start_time, body.end_time
    shift.grace_period_minutes, shift.working_days = body.grace_period_minutes, body.working_days
    changes = audit.diff(before, _snapshot(shift))
    if changes:
        audit.record(db, principal, "shift.updated", "shift", shift.id, f"Updated shift {shift.name}", changes)
    db.commit()
    return serializers.shift(shift, _counts(db).get(shift.id, 0))


@router.post("/{shift_id}/status")
def set_status(shift_id: uuid.UUID, body: StatusBody, principal: Principal = Depends(require("shifts.manage")),
               db: Session = Depends(get_db)) -> dict:
    shift = _get(db, shift_id)
    count = _counts(db).get(shift.id, 0)
    if shift.status != body.status:
        shift.status = body.status
        audit.record(db, principal, f"shift.{'deactivated' if body.status == 'inactive' else 'activated'}", "shift", shift.id,
                     f"{'Deactivated' if body.status == 'inactive' else 'Activated'} shift {shift.name}"
                     + (f" ({count} active employees keep it until reassigned)" if body.status == "inactive" and count else ""))
        db.commit()
    return serializers.shift(shift, count)


@router.put("/{shift_id}/employees")
def assign_employees(shift_id: uuid.UUID, body: ShiftEmployeesBody, principal: Principal = Depends(require("shifts.manage")),
                     db: Session = Depends(get_db)) -> dict:
    shift = _get(db, shift_id)
    if shift.status != "active":
        raise invalid("This shift is inactive. Activate it before assigning employees.")
    ids = set(body.employee_ids)
    found = db.scalars(select(Employee).where(Employee.id.in_(ids))).all()
    if len(found) != len(ids):
        raise invalid("One or more selected employees no longer exist. Reload and try again.")
    moved = [e for e in found if e.shift_id != shift.id]
    db.execute(update(Employee).where(Employee.id.in_(ids)).values(shift_id=shift.id))
    for e in moved:
        audit.record(db, principal, "employee.shift_assigned", "employee", e.id, f"Assigned {e.full_name} to shift {shift.name}",
                     {"shift": {"from": e.shift.name if e.shift else None, "to": shift.name}})
    db.commit()
    return serializers.shift(shift, _counts(db).get(shift.id, 0))
