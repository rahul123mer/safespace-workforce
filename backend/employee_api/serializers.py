"""Response shapes. Face embeddings and raw stream credentials never appear in
any of them."""
from __future__ import annotations

import uuid
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    AuditEntry,
    Camera,
    Employee,
    FaceRegistration,
    FootageRecording,
    RecognitionEvent,
    Shift,
    User,
)
from .pipeline import face_registration as face_reg
from .pipeline import footage_analysis
from .security import PERMISSIONS, ROLE_LABELS
from .services.attendance import camera_brief


def iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def hhmm(value) -> str | None:
    return value.strftime("%H:%M") if value is not None else None


def user(u: User) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "fullName": u.full_name,
        "role": u.role,
        "roleLabel": ROLE_LABELS[u.role],
        "isActive": u.is_active,
        "lastLoginAt": iso(u.last_login_at),
        "createdAt": iso(u.created_at),
    }


def session_payload(u: User, csrf_token: str, site_timezone: str) -> dict:
    return {
        "user": user(u),
        "permissions": sorted(PERMISSIONS[u.role]),
        "csrfToken": csrf_token,
        "siteTimezone": site_timezone,
    }


def shift_brief(s: Shift | None) -> dict | None:
    if s is None:
        return None
    return {
        "id": str(s.id),
        "name": s.name,
        "startTime": hhmm(s.start_time),
        "endTime": hhmm(s.end_time),
        "status": s.status,
    }


def shift(s: Shift, employee_count: int) -> dict:
    return {
        **shift_brief(s),
        "shiftType": s.shift_type,
        "gracePeriodMinutes": s.grace_period_minutes,
        "workingDays": list(s.working_days),
        "crossesMidnight": s.end_time <= s.start_time,
        "employeeCount": employee_count,
        "createdAt": iso(s.created_at),
        "updatedAt": iso(s.updated_at),
    }


def effective_face_status(e: Employee, reg: FaceRegistration | None, fingerprint: str | None) -> str:
    if e.face_status != "registered":
        return e.face_status
    model_changed = bool(fingerprint and reg and reg.model_fingerprint and reg.model_fingerprint != fingerprint)
    return "requires_reregistration" if e.reregistration_requested or model_changed else "registered"


def reregistration_reason(e: Employee, reg: FaceRegistration | None, fingerprint: str | None) -> str | None:
    if e.face_status != "registered":
        return None
    if e.reregistration_requested:
        return e.reregistration_reason
    if fingerprint and reg and reg.model_fingerprint and reg.model_fingerprint != fingerprint:
        return "The face recognition model changed after this face was registered."
    return None


def mask_source(url: str | None) -> str | None:
    if not url:
        return None
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    netloc = f"•••@{host}" if parts.username or parts.password else host
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def event(ev: RecognitionEvent) -> dict:
    return {
        "id": str(ev.id),
        "employee": {"id": str(ev.employee.id), "employeeCode": ev.employee.employee_code, "fullName": ev.employee.full_name,
                     "department": ev.employee.department},
        "camera": camera_brief(ev.camera),
        "eventType": ev.event_type,
        "occurredAt": iso(ev.occurred_at),
        "confidence": ev.confidence,
        "source": ev.source,
        "status": ev.status,
        "decisionMethod": ev.decision_method,
        "recordingId": str(ev.recording_id),
        "sourceOffsetMs": ev.source_offset_ms,
        "reviewedAt": iso(ev.reviewed_at),
    }


def registration(reg: FaceRegistration, *, active_id: uuid.UUID | None) -> dict:
    return {
        "id": str(reg.id),
        "status": reg.status,
        "isCurrent": reg.id == active_id or (reg.pose_slot != "front" and reg.status == "registered"),
        "poseSlot": reg.pose_slot,
        "captureMethod": reg.capture_method,
        "imageAvailable": bool(reg.image_path),
        "imageWidth": reg.image_width,
        "imageHeight": reg.image_height,
        "faceSizePx": reg.face_size_px,
        "detectionScore": round(reg.det_score, 3) if reg.det_score is not None else None,
        "headPose": reg.head_pose,
        "failureReason": reg.failure_reason,
        "failureMessage": face_reg.failure_message(reg.failure_reason),
        "failureDetail": reg.failure_detail if reg.failure_reason not in ("pipeline_error",) else None,
        "createdAt": iso(reg.created_at),
        "completedAt": iso(reg.completed_at),
    }


class EmployeeContext:
    """Batch-loads what employee rows show (latest detection, current
    registration) so a page of employees costs a fixed number of queries."""

    def __init__(self, db: Session, employees: list[Employee], fingerprint: str | None):
        self.fingerprint = fingerprint
        ids = [e.id for e in employees]
        self.registrations: dict[uuid.UUID, FaceRegistration] = {}
        self.latest: dict[uuid.UUID, RecognitionEvent] = {}
        if not ids:
            return
        reg_ids = [e.active_registration_id for e in employees if e.active_registration_id]
        if reg_ids:
            for r in db.scalars(select(FaceRegistration).where(FaceRegistration.id.in_(reg_ids))):
                self.registrations[r.id] = r
        for ev in db.scalars(
            select(RecognitionEvent)
            .distinct(RecognitionEvent.employee_id)
            .where(RecognitionEvent.employee_id.in_(ids), RecognitionEvent.status == "confirmed")
            .order_by(RecognitionEvent.employee_id, RecognitionEvent.occurred_at.desc())
        ):
            self.latest[ev.employee_id] = ev

    def row(self, e: Employee, *, inside) -> dict:
        reg = self.registrations.get(e.active_registration_id) if e.active_registration_id else None
        latest = self.latest.get(e.id)
        if latest is None:
            presence = "no_activity"
        elif inside(latest):
            presence = "in"
        else:
            # An IN older than the maximum session with no OUT is not evidence of leaving.
            presence = "out" if latest.event_type == "out" else "exit_not_recorded"
        return {
            "id": str(e.id),
            "employeeCode": e.employee_code,
            "fullName": e.full_name,
            "email": e.email,
            "phone": e.phone,
            "department": e.department,
            "designation": e.designation,
            "employmentType": e.employment_type,
            "joiningDate": e.joining_date.isoformat(),
            "status": e.status,
            "shift": shift_brief(e.shift),
            "faceStatus": effective_face_status(e, reg, self.fingerprint),
            "reregistrationReason": reregistration_reason(e, reg, self.fingerprint),
            "faceRegisteredAt": iso(e.face_registered_at),
            "presence": presence,
            "lastDetected": {"at": iso(latest.occurred_at), "eventType": latest.event_type, "camera": camera_brief(latest.camera)} if latest else None,
            "deactivatedAt": iso(e.deactivated_at),
            "createdAt": iso(e.created_at),
            "updatedAt": iso(e.updated_at),
        }


def camera_status(cam: Camera) -> tuple[str, list[str]]:
    issues: list[str] = []
    if not cam.source_url:
        issues.append("No stream address is configured.")
    if not cam.enabled:
        return "disabled", issues
    if issues:
        return "configuration_required", issues
    if cam.connection_status == "online":
        return "online", issues
    if cam.connection_status == "offline":
        return "offline", issues
    return "not_verified", issues


def camera_last_events(db: Session, camera_ids: list[uuid.UUID]) -> dict[uuid.UUID, RecognitionEvent]:
    if not camera_ids:
        return {}
    return {
        ev.camera_id: ev
        for ev in db.scalars(
            select(RecognitionEvent)
            .distinct(RecognitionEvent.camera_id)
            .where(RecognitionEvent.camera_id.in_(camera_ids))
            .order_by(RecognitionEvent.camera_id, RecognitionEvent.occurred_at.desc())
        )
    }


def camera(cam: Camera, last: RecognitionEvent | None, *, show_source: bool) -> dict:
    status, issues = camera_status(cam)
    return {
        "id": str(cam.id),
        "cameraCode": cam.camera_code,
        "name": cam.name,
        "location": cam.location,
        "cameraType": cam.camera_type,
        "direction": cam.direction,
        "sourceConfigured": bool(cam.source_url),
        "sourceDisplay": cam.source_url if show_source else mask_source(cam.source_url),
        "enabled": cam.enabled,
        "status": status,
        "configurationIssues": issues,
        "connectionStatus": cam.connection_status,
        "lastCheckedAt": iso(cam.last_checked_at),
        "lastCheckMessage": cam.last_check_message,
        "lastEvent": {"at": iso(last.occurred_at), "eventType": last.event_type, "employeeName": last.employee.full_name,
                      "status": last.status} if last else None,
        "createdAt": iso(cam.created_at),
        "updatedAt": iso(cam.updated_at),
    }


def footage(rec: FootageRecording) -> dict:
    return {
        "id": str(rec.id),
        "camera": camera_brief(rec.camera),
        "originalFilename": rec.original_filename,
        "sizeBytes": rec.size_bytes,
        "captureStartedAt": iso(rec.capture_started_at),
        "durationMs": rec.duration_ms,
        "status": rec.status,
        "failureCode": rec.failure_code,
        "failureMessage": footage_analysis.FAILURE_MESSAGES.get(rec.failure_code or "") if rec.failure_code else None,
        "failureDetail": rec.failure_detail if rec.failure_code == "pipeline_unavailable" else None,
        "galleryEmployeeCount": rec.gallery_employee_count,
        "identityDecisions": rec.identity_decisions,
        "eventsConfirmed": rec.events_confirmed,
        "eventsNeedsReview": rec.events_needs_review,
        "eventsOther": rec.events_other,
        "createdAt": iso(rec.created_at),
        "processingStartedAt": iso(rec.processing_started_at),
        "completedAt": iso(rec.completed_at),
    }


def audit_entry(a: AuditEntry) -> dict:
    return {
        "id": str(a.id),
        "action": a.action,
        "actor": a.actor_label,
        "summary": a.summary,
        "changes": a.changes,
        "createdAt": iso(a.created_at),
    }

