"""Passwords (Argon2id), opaque session tokens and the role/permission matrix."""
from __future__ import annotations

import hashlib
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

SESSION_COOKIE = "ems_session"
CSRF_HEADER = "X-CSRF-Token"
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

_hasher = PasswordHasher()

ROLE_LABELS = {
    "administrator": "Administrator",
    "hr_manager": "HR Manager",
    "viewer": "Attendance Viewer",
}

_VIEW = {
    "employees.view", "shifts.view", "cameras.view", "events.view", "attendance.view",
    "footage.view", "settings.view", "dashboard.view",
}
_HR = _VIEW | {
    "employees.manage", "faces.view", "faces.manage", "shifts.manage",
    "events.review", "audit.view",
}
_ADMIN = _HR | {"cameras.manage", "cameras.view_source", "footage.manage", "settings.manage", "users.manage"}

PERMISSIONS: dict[str, frozenset[str]] = {
    "viewer": frozenset(_VIEW),
    "hr_manager": frozenset(_HR),
    "administrator": frozenset(_ADMIN),
}


def has_permission(role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(role, frozenset())


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def password_problem(password: str) -> str | None:
    """Returns why a password is unacceptable, or None."""
    if len(password) < 12:
        return "Use at least 12 characters."
    if len(password) > 128:
        return "Use at most 128 characters."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Include at least one letter and one number."
    return None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Verified against when no account matches, so an unknown email costs the same time.
DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))
