from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import audit, serializers
from ..db import get_db
from ..deps import Principal, require
from ..errors import conflict, invalid, not_found
from ..models import User, UserSession
from ..schemas import PasswordResetBody, UserCreateBody, UserUpdateBody
from ..security import ROLE_LABELS, hash_password, password_problem

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(_: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)) -> dict:
    users = db.scalars(select(User).order_by(User.full_name)).all()
    return {"items": [serializers.user(u) for u in users], "roles": [{"value": k, "label": v} for k, v in ROLE_LABELS.items()]}


@router.post("", status_code=201)
def create_user(body: UserCreateBody, principal: Principal = Depends(require("users.manage")), db: Session = Depends(get_db)) -> dict:
    email = str(body.email).lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise conflict("email_taken", "An account with this email already exists.", {"email": "An account with this email already exists."})
    problem = password_problem(body.password)
    if problem:
        raise invalid(problem, {"password": problem})
    user = User(email=email, full_name=body.full_name, role=body.role, is_active=True, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    audit.record(db, principal, "user.created", "user", user.id, f"Created {ROLE_LABELS[user.role]} account for {user.full_name}",
                 {"email": email, "role": user.role})
    db.commit()
    return serializers.user(user)


def _active_admins(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == "administrator", User.is_active.is_(True)))


@router.patch("/{user_id}")
def update_user(user_id: uuid.UUID, body: UserUpdateBody, principal: Principal = Depends(require("users.manage")),
                db: Session = Depends(get_db)) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("user account")
    before = {"fullName": user.full_name, "role": user.role, "isActive": user.is_active}
    losing_admin = user.role == "administrator" and user.is_active and (
        (body.role is not None and body.role != "administrator") or body.is_active is False
    )
    if losing_admin and _active_admins(db) <= 1:
        raise conflict("last_administrator", "At least one active administrator is required. Assign another administrator first.")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
        if not body.is_active:
            db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    after = {"fullName": user.full_name, "role": user.role, "isActive": user.is_active}
    changes = audit.diff(before, after)
    if changes:
        audit.record(db, principal, "user.updated", "user", user.id, f"Updated account of {user.full_name}", changes)
    db.commit()
    return serializers.user(user)


@router.post("/{user_id}/password", status_code=204)
def reset_password(user_id: uuid.UUID, body: PasswordResetBody, principal: Principal = Depends(require("users.manage")),
                   db: Session = Depends(get_db)) -> Response:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("user account")
    problem = password_problem(body.new_password)
    if problem:
        raise invalid(problem, {"newPassword": problem})
    user.password_hash = hash_password(body.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    audit.record(db, principal, "user.password_reset", "user", user.id, f"Reset the password of {user.full_name}")
    db.commit()
    return Response(status_code=204)
