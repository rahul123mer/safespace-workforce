from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from .. import audit, jobs, serializers, storage
from ..config import get_settings
from ..db import get_db
from ..deps import Principal, require
from ..errors import ApiError, conflict, invalid, not_found
from ..models import AuditEntry, Employee, FaceRegistration, RecognitionEvent, Shift
from ..pipeline.face_registration import SLOT_LABELS, current_samples, discard
from ..pipeline.status import model_fingerprint
from ..schemas import EmployeeCreateBody, EmployeeStatusBody, EmployeeUpdateBody, ReregistrationBody
from ..services.attendance import is_inside
from ..services.rules import load_rules

router = APIRouter(tags=["employees"])

SORTS = {
    "name": Employee.full_name,
    "employeeCode": Employee.employee_code,
    "department": Employee.department,
    "designation": Employee.designation,
    "joiningDate": Employee.joining_date,
    "createdAt": Employee.created_at,
}
FACE_FILTERS = ("not_registered", "processing", "registered", "failed", "requires_reregistration")


def _get(db: Session, employee_id: uuid.UUID) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise not_found("employee")
    return employee


def _inside_fn(db: Session):
    rules = load_rules(db)
    now = datetime.now(timezone.utc)
    return lambda ev: is_inside(ev, rules, now)


def _rows(db: Session, employees: list[Employee]) -> list[dict]:
    ctx = serializers.EmployeeContext(db, employees, model_fingerprint())
    inside = _inside_fn(db)
    return [ctx.row(e, inside=inside) for e in employees]


@router.get("/employees")
def list_employees(
    search: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, pattern="^(active|inactive)$"),
    face_status: str | None = Query(default=None, alias="faceStatus"),
    shift_id: str | None = Query(default=None, alias="shiftId"),
    department: str | None = Query(default=None, max_length=80),
    sort: str = Query(default="name"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100, alias="pageSize"),
    _: Principal = Depends(require("employees.view")),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Employee)
    if search and search.strip():
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(Employee.full_name.ilike(like), Employee.employee_code.ilike(like), Employee.email.ilike(like),
                              Employee.department.ilike(like), Employee.designation.ilike(like)))
    if status:
        stmt = stmt.where(Employee.status == status)
    if department:
        stmt = stmt.where(Employee.department == department)
    if shift_id == "none":
        stmt = stmt.where(Employee.shift_id.is_(None))
    elif shift_id:
        try:
            stmt = stmt.where(Employee.shift_id == uuid.UUID(shift_id))
        except ValueError:
            raise invalid("Choose a valid shift.", {"shiftId": "Choose a valid shift."}) from None
    if face_status:
        if face_status not in FACE_FILTERS:
            raise invalid("Choose a valid face registration status.")
        if face_status in ("registered", "requires_reregistration"):
            reg = aliased(FaceRegistration)
            fingerprint = model_fingerprint()
            stale = Employee.reregistration_requested.is_(True)
            if fingerprint:
                stale = or_(stale, and_(reg.model_fingerprint.is_not(None), reg.model_fingerprint != fingerprint))
            stmt = stmt.outerjoin(reg, reg.id == Employee.active_registration_id).where(Employee.face_status == "registered")
            stmt = stmt.where(stale if face_status == "requires_reregistration" else ~stale)
        else:
            stmt = stmt.where(Employee.face_status == face_status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    column = SORTS.get(sort, Employee.full_name)
    stmt = stmt.order_by(column.desc() if order == "desc" else column.asc(), Employee.id)
    employees = list(db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).unique())
    return {"items": _rows(db, employees), "total": total, "page": page, "pageSize": page_size}


@router.get("/employees/directory")
def directory(_: Principal = Depends(require("employees.view")), db: Session = Depends(get_db)) -> dict:
    """Departments and designations already in use, for filters and form suggestions."""
    departments = db.scalars(select(Employee.department).distinct().order_by(Employee.department)).all()
    designations = db.scalars(select(Employee.designation).distinct().order_by(Employee.designation)).all()
    return {"departments": departments, "designations": designations}


@router.get("/employees/options")
def employee_options(
    status: str | None = Query(default="active", pattern="^(active|inactive|all)$"),
    _: Principal = Depends(require("employees.view")),
    db: Session = Depends(get_db),
) -> dict:
    """Compact list for pickers and filters."""
    stmt = select(Employee).order_by(Employee.full_name)
    if status != "all":
        stmt = stmt.where(Employee.status == status)
    return {"items": [
        {"id": str(e.id), "employeeCode": e.employee_code, "fullName": e.full_name, "department": e.department,
         "shiftId": str(e.shift_id) if e.shift_id else None, "status": e.status}
        for e in db.scalars(stmt)
    ]}


def _check_unique(db: Session, body: EmployeeCreateBody | EmployeeUpdateBody, exclude: uuid.UUID | None = None) -> None:
    fields: dict[str, str] = {}
    code_q = select(Employee.id).where(func.lower(Employee.employee_code) == body.employee_code.lower())
    if exclude:
        code_q = code_q.where(Employee.id != exclude)
    if db.scalar(code_q):
        fields["employeeCode"] = "Another employee already uses this Employee ID."
    if body.email:
        email_q = select(Employee.id).where(func.lower(Employee.email) == str(body.email).lower())
        if exclude:
            email_q = email_q.where(Employee.id != exclude)
        if db.scalar(email_q):
            fields["email"] = "Another employee already uses this email address."
    if fields:
        raise conflict("duplicate_employee", "An employee with the same Employee ID or email already exists.", fields)


def _check_shift(db: Session, shift_id: uuid.UUID | None, current: uuid.UUID | None = None) -> None:
    if shift_id is None:
        return
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise invalid("The selected shift does not exist.", {"shiftId": "The selected shift does not exist."})
    if shift.status != "active" and shift_id != current:
        raise invalid("The selected shift is inactive. Activate it or choose another shift.",
                      {"shiftId": "This shift is inactive."})


def _snapshot(e: Employee) -> dict:
    return {
        "employeeCode": e.employee_code, "fullName": e.full_name, "email": e.email, "phone": e.phone,
        "department": e.department, "designation": e.designation, "employmentType": e.employment_type,
        "joiningDate": e.joining_date.isoformat(), "status": e.status,
        "shift": e.shift.name if e.shift else None,
    }


@router.post("/employees", status_code=201)
def create_employee(body: EmployeeCreateBody, principal: Principal = Depends(require("employees.manage")),
                    db: Session = Depends(get_db)) -> dict:
    _check_unique(db, body)
    _check_shift(db, body.shift_id)
    employee = Employee(
        employee_code=body.employee_code, full_name=body.full_name, email=str(body.email).lower() if body.email else None,
        phone=body.phone, department=body.department, designation=body.designation, employment_type=body.employment_type,
        joining_date=body.joining_date, status=body.status, shift_id=body.shift_id, face_status="not_registered",
        deactivated_at=datetime.now(timezone.utc) if body.status == "inactive" else None,
    )
    db.add(employee)
    db.flush()
    db.refresh(employee)
    audit.record(db, principal, "employee.created", "employee", employee.id,
                 f"Registered employee {employee.full_name} ({employee.employee_code})", _snapshot(employee))
    db.commit()
    return _rows(db, [employee])[0]


@router.get("/employees/{employee_id}")
def get_employee(employee_id: uuid.UUID, principal: Principal = Depends(require("employees.view")),
                 db: Session = Depends(get_db)) -> dict:
    employee = _get(db, employee_id)
    row = _rows(db, [employee])[0]
    current = db.get(FaceRegistration, employee.active_registration_id) if employee.active_registration_id else None
    latest = db.scalar(select(FaceRegistration).where(FaceRegistration.employee_id == employee.id,
                                                      FaceRegistration.pose_slot == "front")
                       .order_by(FaceRegistration.created_at.desc()).limit(1))
    row["faceRegistration"] = serializers.registration(current, active_id=employee.active_registration_id) if current else None
    row["latestRegistrationAttempt"] = (
        serializers.registration(latest, active_id=employee.active_registration_id) if latest else None
    )
    samples = current_samples(db, employee)
    row["faceSamples"] = {}
    for slot in ("front", "left", "right"):
        attempt = db.scalar(select(FaceRegistration).where(FaceRegistration.employee_id == employee.id,
                                                           FaceRegistration.pose_slot == slot)
                            .order_by(FaceRegistration.created_at.desc()).limit(1))
        row["faceSamples"][slot] = {
            "current": serializers.registration(samples[slot], active_id=employee.active_registration_id) if slot in samples else None,
            "latestAttempt": serializers.registration(attempt, active_id=employee.active_registration_id) if attempt else None,
        }
    row["canViewFace"] = principal.can("faces.view")
    return row


@router.patch("/employees/{employee_id}")
def update_employee(employee_id: uuid.UUID, body: EmployeeUpdateBody, principal: Principal = Depends(require("employees.manage")),
                    db: Session = Depends(get_db)) -> dict:
    employee = _get(db, employee_id)
    _check_unique(db, body, exclude=employee.id)
    _check_shift(db, body.shift_id, current=employee.shift_id)
    before = _snapshot(employee)
    employee.employee_code = body.employee_code
    employee.full_name = body.full_name
    employee.email = str(body.email).lower() if body.email else None
    employee.phone = body.phone
    employee.department = body.department
    employee.designation = body.designation
    employee.employment_type = body.employment_type
    employee.joining_date = body.joining_date
    employee.shift_id = body.shift_id
    db.flush()
    db.refresh(employee)
    changes = audit.diff(before, _snapshot(employee))
    if changes:
        audit.record(db, principal, "employee.updated", "employee", employee.id,
                     f"Updated {', '.join(changes)} of {employee.full_name}", changes)
    db.commit()
    return _rows(db, [employee])[0]


@router.post("/employees/{employee_id}/status")
def set_status(employee_id: uuid.UUID, body: EmployeeStatusBody, principal: Principal = Depends(require("employees.manage")),
               db: Session = Depends(get_db)) -> dict:
    employee = _get(db, employee_id)
    if employee.status != body.status:
        employee.status = body.status
        employee.deactivated_at = datetime.now(timezone.utc) if body.status == "inactive" else None
        verb = "Deactivated" if body.status == "inactive" else "Activated"
        audit.record(db, principal, f"employee.{'deactivated' if body.status == 'inactive' else 'activated'}", "employee",
                     employee.id, f"{verb} {employee.full_name}" + (f": {body.reason}" if body.reason else ""),
                     {"status": {"from": "active" if body.status == "inactive" else "inactive", "to": body.status}})
        db.commit()
    return _rows(db, [employee])[0]


# --- face registration -------------------------------------------------------

async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "image_too_large", f"The image is larger than {limit // (1024 * 1024)} MB. Upload a smaller JPEG or PNG image.")
    return data


@router.post("/employees/{employee_id}/face-registrations", status_code=202)
async def register_face(
    employee_id: uuid.UUID,
    image: UploadFile = File(...),
    capture_method: str = Form(default="upload", alias="captureMethod", pattern="^(upload|camera)$"),
    pose_slot: str = Form(default="front", alias="poseSlot", pattern="^(front|left|right)$"),
    replace_existing: bool = Form(default=False, alias="replaceExisting"),
    principal: Principal = Depends(require("faces.manage")),
    db: Session = Depends(get_db),
) -> dict:
    employee = _get(db, employee_id)
    if employee.status != "active":
        raise conflict("employee_inactive", "This employee is inactive. Activate the employee before registering a face.")
    if db.scalar(select(FaceRegistration.id).where(FaceRegistration.employee_id == employee.id,
                                                   FaceRegistration.pose_slot == pose_slot,
                                                   FaceRegistration.status == "processing")):
        raise conflict("registration_in_progress",
                       f"A {SLOT_LABELS[pose_slot]} image is already being processed for this employee. Wait for it to finish.")
    samples = current_samples(db, employee)
    if pose_slot != "front" and "front" not in samples:
        raise conflict("front_required", "Register the front face first. Side images can be added once a front image is registered.")
    if pose_slot in samples and not replace_existing:
        if pose_slot == "front":
            raise conflict("face_already_registered",
                           "A face is already registered for this employee. Re-registering will replace the existing registration.")
        raise conflict("face_already_registered",
                       f"A {SLOT_LABELS[pose_slot]} image is already registered for this employee. Registering a new one will replace it.")
    declared = (image.content_type or "").lower()
    if declared and declared not in storage.ACCEPTED_IMAGE_TYPES:
        raise ApiError(415, "unsupported_file_type", "Unsupported file type. Upload a JPEG or PNG image.")
    data = await _read_limited(image, get_settings().max_face_image_bytes)
    if not data:
        raise invalid("The uploaded file is empty. Choose a JPEG or PNG image.")
    info = storage.inspect_image(data)
    if info is None:
        raise ApiError(422, "invalid_image", "The file is not a valid JPEG or PNG image. Upload a photo exported as JPEG or PNG.")
    if min(info.width, info.height) < storage.MIN_IMAGE_EDGE_PX:
        raise ApiError(422, "image_too_small",
                       f"The image is only {info.width}×{info.height} px. Upload an image at least {storage.MIN_IMAGE_EDGE_PX} px on each side.")

    reg = FaceRegistration(
        employee_id=employee.id, status="processing", capture_method=capture_method, pose_slot=pose_slot,
        image_media_type=info.media_type, image_width=info.width, image_height=info.height,
        image_sha256=storage.sha256_bytes(data), submitted_by=principal.user.id,
    )
    db.add(reg)
    db.flush()
    reg.image_path = f"faces/{employee.id}/{pose_slot}-{reg.id}{storage.ACCEPTED_IMAGE_TYPES[info.media_type]}"
    storage.write_bytes(reg.image_path, data)
    if pose_slot == "front":
        employee.face_status = "processing"
    jobs.enqueue(db, jobs.FACE_REGISTRATION, {"targetId": str(reg.id)})
    audit.record(db, principal, "face.submitted", "employee", employee.id,
                 f"Submitted a {SLOT_LABELS[pose_slot]} face image for {employee.full_name} "
                 f"({'camera capture' if capture_method == 'camera' else 'upload'})",
                 {"registrationId": str(reg.id), "poseSlot": pose_slot, "replaceExisting": pose_slot in samples})
    db.commit()
    return serializers.registration(reg, active_id=employee.active_registration_id)


@router.get("/employees/{employee_id}/face-registrations")
def list_registrations(employee_id: uuid.UUID, _: Principal = Depends(require("employees.view")),
                       db: Session = Depends(get_db)) -> dict:
    employee = _get(db, employee_id)
    regs = db.scalars(select(FaceRegistration).where(FaceRegistration.employee_id == employee.id)
                      .order_by(FaceRegistration.created_at.desc()).limit(50))
    return {"items": [serializers.registration(r, active_id=employee.active_registration_id) for r in regs]}


@router.get("/face-registrations/{registration_id}")
def get_registration(registration_id: uuid.UUID, _: Principal = Depends(require("employees.view")),
                     db: Session = Depends(get_db)) -> dict:
    reg = db.get(FaceRegistration, registration_id)
    if reg is None:
        raise not_found("face registration")
    employee = db.get(Employee, reg.employee_id)
    return serializers.registration(reg, active_id=employee.active_registration_id)


@router.get("/face-registrations/{registration_id}/image")
def registration_image(registration_id: uuid.UUID, _: Principal = Depends(require("faces.view")),
                       db: Session = Depends(get_db)) -> FileResponse:
    reg = db.get(FaceRegistration, registration_id)
    if reg is None or not reg.image_path:
        raise not_found("face image")
    path = storage.resolve(reg.image_path)
    if not path.exists():
        raise not_found("face image")
    return FileResponse(path, media_type=reg.image_media_type,
                        headers={"Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"})


@router.post("/employees/{employee_id}/face/reregistration-request")
def request_reregistration(employee_id: uuid.UUID, body: ReregistrationBody, principal: Principal = Depends(require("faces.manage")),
                           db: Session = Depends(get_db)) -> dict:
    employee = _get(db, employee_id)
    if not employee.active_registration_id:
        raise conflict("face_not_registered", "No face has been registered for this employee.")
    employee.reregistration_requested = True
    employee.reregistration_reason = body.reason
    audit.record(db, principal, "face.reregistration_requested", "employee", employee.id,
                 f"Requested face re-registration for {employee.full_name}: {body.reason}")
    db.commit()
    return _rows(db, [employee])[0]


@router.delete("/employees/{employee_id}/face", status_code=204)
def remove_face(employee_id: uuid.UUID, principal: Principal = Depends(require("faces.manage")),
                db: Session = Depends(get_db)) -> Response:
    employee = _get(db, employee_id)
    if db.scalar(select(FaceRegistration.id).where(FaceRegistration.employee_id == employee.id,
                                                   FaceRegistration.status == "processing")):
        raise conflict("registration_in_progress", "A face image is being processed. Wait for it to finish before removing face data.")
    samples = current_samples(db, employee)
    if "front" not in samples:
        raise conflict("face_not_registered", "No face has been registered for this employee.")
    for reg in samples.values():
        discard(reg, "removed")
    employee.active_registration_id = None
    employee.face_status = "not_registered"
    employee.face_registered_at = None
    employee.reregistration_requested = False
    employee.reregistration_reason = None
    audit.record(db, principal, "face.removed", "employee", employee.id,
                 f"Removed the registered face of {employee.full_name}; {len(samples)} images and their embeddings were deleted")
    db.commit()
    return Response(status_code=204)


@router.delete("/employees/{employee_id}/face/{pose_slot}", status_code=204)
def remove_side_image(employee_id: uuid.UUID, pose_slot: str, principal: Principal = Depends(require("faces.manage")),
                      db: Session = Depends(get_db)) -> Response:
    """Removes one optional side image; the front image stays (use DELETE .../face to remove everything)."""
    if pose_slot not in ("left", "right"):
        raise invalid("Only the left or right image can be removed on its own. Remove all face data to delete the front image.")
    employee = _get(db, employee_id)
    reg = current_samples(db, employee).get(pose_slot)
    if reg is None:
        raise conflict("face_not_registered", f"No {SLOT_LABELS[pose_slot]} image is registered for this employee.")
    discard(reg, "removed")
    audit.record(db, principal, "face.side_removed", "employee", employee.id,
                 f"Removed the {SLOT_LABELS[pose_slot]} face image of {employee.full_name}", {"poseSlot": pose_slot})
    db.commit()
    return Response(status_code=204)


# --- activity & history ------------------------------------------------------

@router.get("/employees/{employee_id}/history")
def employee_history(employee_id: uuid.UUID, _: Principal = Depends(require("audit.view")),
                     db: Session = Depends(get_db)) -> dict:
    _get(db, employee_id)
    entries = db.scalars(select(AuditEntry).where(AuditEntry.target_type == "employee", AuditEntry.target_id == employee_id)
                         .order_by(AuditEntry.created_at.desc()).limit(100))
    return {"items": [serializers.audit_entry(a) for a in entries]}


@router.get("/employees/{employee_id}/events")
def employee_events(employee_id: uuid.UUID, limit: int = Query(default=50, ge=1, le=200),
                    _: Principal = Depends(require("events.view")), db: Session = Depends(get_db)) -> dict:
    _get(db, employee_id)
    events = db.scalars(select(RecognitionEvent).where(RecognitionEvent.employee_id == employee_id)
                        .order_by(RecognitionEvent.occurred_at.desc()).limit(limit))
    return {"items": [serializers.event(e) for e in events]}
