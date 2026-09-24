"""Request bodies. JSON is camelCase; validation messages are written for the
administrator and shown next to the field in the UI."""
from __future__ import annotations

import re
import uuid
from datetime import date, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from .models import CAMERA_DIRECTIONS, CAMERA_TYPES, EMPLOYMENT_TYPES, SHIFT_TYPES, USER_ROLES

CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$")
PHONE_RE = re.compile(r"^\+?[0-9 ()-]{7,20}$")


class Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", str_strip_whitespace=True)


def _one_of(value: str, allowed: tuple[str, ...], label: str) -> str:
    if value not in allowed:
        raise ValueError(f"Choose a valid {label}.")
    return value


# --- auth / users -----------------------------------------------------------

class LoginBody(Body):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class PasswordChangeBody(Body):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class UserCreateBody(Body):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    role: str
    password: str = Field(min_length=1, max_length=128)

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        return _one_of(v, USER_ROLES, "role")


class UserUpdateBody(Body):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    role: str | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def _role(cls, v):
        return None if v is None else _one_of(v, USER_ROLES, "role")


class PasswordResetBody(Body):
    new_password: str = Field(min_length=1, max_length=128)


# --- employees --------------------------------------------------------------

class EmployeeFields(Body):
    employee_code: str = Field(min_length=1, max_length=40)
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    department: str = Field(min_length=2, max_length=80)
    designation: str = Field(min_length=2, max_length=80)
    employment_type: str
    joining_date: date
    status: str = "active"
    shift_id: uuid.UUID | None = None

    @field_validator("employee_code")
    @classmethod
    def _code(cls, v: str) -> str:
        if not CODE_RE.match(v):
            raise ValueError("Use letters, numbers, dots, slashes or hyphens, starting with a letter or number.")
        return v

    @field_validator("email", "phone", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        if v is not None and not PHONE_RE.match(v):
            raise ValueError("Enter a phone number with 7 to 20 digits, optionally starting with +.")
        return v

    @field_validator("employment_type")
    @classmethod
    def _employment(cls, v: str) -> str:
        return _one_of(v, EMPLOYMENT_TYPES, "employment type")

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        return _one_of(v, ("active", "inactive"), "status")

    @field_validator("joining_date")
    @classmethod
    def _joining(cls, v: date) -> date:
        if v.year < 1950:
            raise ValueError("Enter a joining date after 1950.")
        return v


class EmployeeCreateBody(EmployeeFields):
    pass


class EmployeeUpdateBody(EmployeeFields):
    status: str | None = None  # status changes go through the activate/deactivate action


class EmployeeStatusBody(Body):
    status: str
    reason: str | None = Field(default=None, max_length=300)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        return _one_of(v, ("active", "inactive"), "status")


class ReregistrationBody(Body):
    reason: str = Field(min_length=3, max_length=300)


# --- shifts -----------------------------------------------------------------

class ShiftBody(Body):
    name: str = Field(min_length=2, max_length=80)
    shift_type: str
    start_time: time
    end_time: time
    grace_period_minutes: int = Field(ge=0, le=240)
    working_days: list[int] = Field(min_length=1, max_length=7)

    @field_validator("shift_type")
    @classmethod
    def _type(cls, v: str) -> str:
        return _one_of(v, SHIFT_TYPES, "shift type")

    @field_validator("working_days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in v):
            raise ValueError("Working days must be between Monday and Sunday.")
        return sorted(set(v))

    @model_validator(mode="after")
    def _times(self):
        if self.start_time == self.end_time:
            raise ValueError("Shift start and end times must differ.")
        return self


class StatusBody(Body):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        return _one_of(v, ("active", "inactive"), "status")


class ShiftEmployeesBody(Body):
    employee_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


# --- cameras ----------------------------------------------------------------

class CameraBody(Body):
    camera_code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    location: str = Field(min_length=2, max_length=160)
    camera_type: str
    direction: str
    source_url: str | None = Field(default=None, max_length=1000)

    @field_validator("camera_code")
    @classmethod
    def _code(cls, v: str) -> str:
        if not CODE_RE.match(v):
            raise ValueError("Use letters, numbers, dots, slashes or hyphens, starting with a letter or number.")
        return v

    @field_validator("camera_type")
    @classmethod
    def _type(cls, v: str) -> str:
        return _one_of(v, CAMERA_TYPES, "camera type")

    @field_validator("direction")
    @classmethod
    def _direction(cls, v: str) -> str:
        return _one_of(v, CAMERA_DIRECTIONS, "direction")

    @field_validator("source_url", mode="before")
    @classmethod
    def _source(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return None
            if not re.match(r"^(rtsp|rtsps|http|https)://", v, re.I):
                raise ValueError("Enter a stream address starting with rtsp://, rtsps://, http:// or https://.")
        return v


class CameraUpdateBody(CameraBody):
    # The stored stream address is only replaced when `replaceSource` is true,
    # so an edit form never has to receive the address (and its credentials).
    replace_source: bool = False


class CameraEnabledBody(Body):
    enabled: bool


# --- events -----------------------------------------------------------------

class EventReviewBody(Body):
    decision: str

    @field_validator("decision")
    @classmethod
    def _decision(cls, v: str) -> str:
        return _one_of(v, ("confirm", "reject"), "review decision")
