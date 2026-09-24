"""Administrator-editable rules, stored as one validated JSON document. Every
field here is read by backend code: attendance processing
(`services/events.py`, `services/attendance.py`), face registration
(`pipeline/face_registration.py`) and time-zone conversion."""
from __future__ import annotations

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from ..models import SystemSettings


class _Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class AttendanceRules(_Model):
    min_event_interval_minutes: int = Field(default=5, ge=0, le=240)
    max_session_hours: int = Field(default=16, ge=1, le=36)
    review_decision_handling: str = Field(default="queue_for_review", pattern="^(queue_for_review|ignore)$")


class RegistrationRules(_Model):
    min_face_size_px: int = Field(default=80, ge=40, le=1000)
    require_frontal_face: bool = True
    duplicate_similarity_threshold: float = Field(default=0.55, ge=0.3, le=0.95)
    # Minimum similarity between a side image and the employee's own front image.
    side_match_min_similarity: float = Field(default=0.25, ge=0.0, le=0.9)


class SystemRules(_Model):
    site_timezone: str = "UTC"
    attendance: AttendanceRules = Field(default_factory=AttendanceRules)
    registration: RegistrationRules = Field(default_factory=RegistrationRules)

    @field_validator("site_timezone")
    @classmethod
    def _tz(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Choose a valid IANA time zone, for example Asia/Kolkata.") from None
        return value

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.site_timezone)


def load_rules(db: Session) -> SystemRules:
    row = db.get(SystemSettings, 1)
    return SystemRules.model_validate(row.data if row else {})


def save_rules(db: Session, rules: SystemRules, user_id) -> None:
    row = db.get(SystemSettings, 1)
    data = rules.model_dump(mode="json")
    if row is None:
        db.add(SystemSettings(id=1, data=data, updated_by=user_id))
    else:
        row.data = data
        row.updated_by = user_id
