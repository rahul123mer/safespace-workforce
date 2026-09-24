"""Persistent entities. Enumerations are stored as short strings with CHECK
constraints so the database refuses values the application never writes."""
from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from .db import Base
from .ids import uuid7

USER_ROLES = ("administrator", "hr_manager", "viewer")
EMPLOYEE_STATUSES = ("active", "inactive")
EMPLOYMENT_TYPES = ("full_time", "part_time", "contract", "intern")
FACE_STATUSES = ("not_registered", "processing", "registered", "failed")
REGISTRATION_STATUSES = ("processing", "registered", "failed", "superseded", "removed")
CAPTURE_METHODS = ("upload", "camera")
POSE_SLOTS = ("front", "left", "right")
SHIFT_TYPES = ("morning", "general", "evening", "night", "custom")
RECORD_STATUSES = ("active", "inactive")
CAMERA_TYPES = ("dome", "bullet", "turret", "ptz", "box", "other")
CAMERA_DIRECTIONS = ("entry", "exit", "entry_exit")
CONNECTION_STATUSES = ("not_verified", "online", "offline")
FOOTAGE_STATUSES = ("queued", "processing", "completed", "failed")
EVENT_TYPES = ("in", "out")
EVENT_STATUSES = ("confirmed", "needs_review", "rejected", "duplicate")
JOB_STATUSES = ("queued", "running", "succeeded", "failed")


def _enum_check(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    quoted = ", ".join(f"'{v}'" for v in values)
    return CheckConstraint(f"{column} IN ({quoted})", name=name)


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


def _updated() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class User(Base):
    __tablename__ = "users"
    __table_args__ = (_enum_check("role", USER_ROLES, "ck_users_role"),)

    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))

    user: Mapped[User] = relationship(lazy="joined")


class Shift(Base):
    __tablename__ = "shifts"
    __table_args__ = (
        _enum_check("shift_type", SHIFT_TYPES, "ck_shifts_type"),
        _enum_check("status", RECORD_STATUSES, "ck_shifts_status"),
        CheckConstraint("grace_period_minutes BETWEEN 0 AND 240", name="ck_shifts_grace"),
        Index("uq_shifts_name_ci", text("lower(name)"), unique=True),
    )

    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    shift_type: Mapped[str] = mapped_column(String(20), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    grace_period_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # ISO weekday numbers, Monday = 1 ... Sunday = 7.
    working_days: Mapped[list[int]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = (
        _enum_check("status", EMPLOYEE_STATUSES, "ck_employees_status"),
        _enum_check("employment_type", EMPLOYMENT_TYPES, "ck_employees_employment_type"),
        _enum_check("face_status", FACE_STATUSES, "ck_employees_face_status"),
        Index("uq_employees_code_ci", text("lower(employee_code)"), unique=True),
        Index("uq_employees_email_ci", text("lower(email)"), unique=True, postgresql_where=text("email IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = _pk()
    employee_code: Mapped[str] = mapped_column(String(40), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(32))
    department: Mapped[str] = mapped_column(String(80), nullable=False)
    designation: Mapped[str] = mapped_column(String(80), nullable=False)
    employment_type: Mapped[str] = mapped_column(String(20), nullable=False)
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")
    shift_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("shifts.id", ondelete="SET NULL"), index=True)
    face_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_registered")
    face_registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active_registration_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("face_registrations.id", ondelete="SET NULL", use_alter=True, name="fk_employees_active_registration")
    )
    reregistration_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reregistration_reason: Mapped[str | None] = mapped_column(String(300))
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    shift: Mapped[Shift | None] = relationship(lazy="joined")


class FaceRegistration(Base):
    __tablename__ = "face_registrations"
    __table_args__ = (
        _enum_check("status", REGISTRATION_STATUSES, "ck_face_registrations_status"),
        _enum_check("capture_method", CAPTURE_METHODS, "ck_face_registrations_capture"),
        _enum_check("pose_slot", POSE_SLOTS, "ck_face_registrations_pose_slot"),
        Index("ix_face_registrations_slot", "employee_id", "pose_slot", "status"),
    )

    id: Mapped[uuid.UUID] = _pk()
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="processing")
    # Which of the employee's reference images this is. The front image is required and
    # is the one `Employee.active_registration_id` points to; left and right are optional.
    pose_slot: Mapped[str] = mapped_column(String(5), nullable=False, default="front", server_default="front")
    capture_method: Mapped[str] = mapped_column(String(10), nullable=False)
    image_path: Mapped[str | None] = mapped_column(Text)
    image_media_type: Mapped[str] = mapped_column(String(40), nullable=False)
    image_width: Mapped[int] = mapped_column(Integer, nullable=False)
    image_height: Mapped[int] = mapped_column(Integer, nullable=False)
    image_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String(40))
    failure_detail: Mapped[str | None] = mapped_column(Text)
    det_score: Mapped[float | None] = mapped_column(Float)
    face_size_px: Mapped[int | None] = mapped_column(Integer)
    head_pose: Mapped[str | None] = mapped_column(String(10))
    # 512-d float32 face embedding from the existing pipeline. Never serialised
    # by any API schema; deferred so ordinary queries never load it.
    embedding: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    model_fingerprint: Mapped[str | None] = mapped_column(String(64))
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Camera(Base):
    __tablename__ = "cameras"
    __table_args__ = (
        _enum_check("camera_type", CAMERA_TYPES, "ck_cameras_type"),
        _enum_check("direction", CAMERA_DIRECTIONS, "ck_cameras_direction"),
        _enum_check("connection_status", CONNECTION_STATUSES, "ck_cameras_connection"),
        Index("uq_cameras_code_ci", text("lower(camera_code)"), unique=True),
    )

    id: Mapped[uuid.UUID] = _pk()
    camera_code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[str] = mapped_column(String(160), nullable=False)
    camera_type: Mapped[str] = mapped_column(String(10), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    connection_status: Mapped[str] = mapped_column(String(14), nullable=False, default="not_verified")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_check_message: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class FootageRecording(Base):
    __tablename__ = "footage_recordings"
    __table_args__ = (_enum_check("status", FOOTAGE_STATUSES, "ck_footage_status"),)

    id: Mapped[uuid.UUID] = _pk()
    camera_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cameras.id", ondelete="RESTRICT"), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    capture_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="queued")
    failure_code: Mapped[str | None] = mapped_column(String(40))
    failure_detail: Mapped[str | None] = mapped_column(Text)
    gallery_employee_count: Mapped[int | None] = mapped_column(Integer)
    identity_decisions: Mapped[int | None] = mapped_column(Integer)
    events_confirmed: Mapped[int | None] = mapped_column(Integer)
    events_needs_review: Mapped[int | None] = mapped_column(Integer)
    events_other: Mapped[int | None] = mapped_column(Integer)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    camera: Mapped[Camera] = relationship(lazy="joined")


class RecognitionEvent(Base):
    __tablename__ = "recognition_events"
    __table_args__ = (
        _enum_check("event_type", EVENT_TYPES, "ck_events_type"),
        _enum_check("status", EVENT_STATUSES, "ck_events_status"),
        Index("ix_events_employee_time", "employee_id", "occurred_at"),
        Index("ix_events_time", "occurred_at"),
        UniqueConstraint("recording_id", "track_segment_id", name="uq_events_segment"),
    )

    id: Mapped[uuid.UUID] = _pk()
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cameras.id", ondelete="RESTRICT"), nullable=False, index=True)
    recording_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("footage_recordings.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(3), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="footage_analysis")
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    decision_method: Mapped[str | None] = mapped_column(String(30))
    identity_decision_id: Mapped[str | None] = mapped_column(String(64))
    track_segment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_offset_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()

    employee: Mapped[Employee] = relationship(lazy="joined")
    camera: Mapped[Camera] = relationship(lazy="joined")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        _enum_check("status", JOB_STATUSES, "ck_jobs_status"),
        Index("ix_jobs_claim", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="queued")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(40))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEntry(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_target", "target_type", "target_id", "created_at"),)

    id: Mapped[uuid.UUID] = _pk()
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str] = mapped_column(String(160), nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    summary: Mapped[str] = mapped_column(String(300), nullable=False)
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created()


class SystemSettings(Base):
    __tablename__ = "system_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_system_settings_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = _updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
