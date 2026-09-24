from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import audit, serializers
from ..config import get_settings
from ..db import get_db
from ..deps import Principal, client_ip, current_principal
from ..errors import ApiError, invalid
from ..models import User, UserSession
from ..schemas import LoginBody, PasswordChangeBody
from ..security import (
    DUMMY_HASH,
    LOCKOUT_MINUTES,
    MAX_FAILED_LOGINS,
    SESSION_COOKIE,
    hash_password,
    new_token,
    password_problem,
    token_digest,
    verify_password,
)
from ..services.rules import load_rules

router = APIRouter(prefix="/auth", tags=["auth"])

BAD_CREDENTIALS = "The email or password is incorrect."


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        SESSION_COOKIE, token, max_age=s.session_ttl_hours * 3600, httponly=True, secure=s.cookie_secure,
        samesite="lax", path="/api",
    )


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if user is None:
        verify_password(DUMMY_HASH, body.password)
        raise ApiError(401, "invalid_credentials", BAD_CREDENTIALS)
    if user.locked_until and user.locked_until > now:
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        raise ApiError(429, "account_locked", f"Too many failed sign-in attempts. Try again in {minutes} minutes.")
    if not verify_password(user.password_hash, body.password):
        user.failed_login_count += 1
        if user.failed_login_count >= MAX_FAILED_LOGINS:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_login_count = 0
        db.commit()
        raise ApiError(401, "invalid_credentials", BAD_CREDENTIALS)
    if not user.is_active:
        raise ApiError(403, "account_disabled", "This account has been deactivated. Contact an administrator.")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.expires_at < now))
    token, csrf = new_token(), new_token()
    db.add(UserSession(
        user_id=user.id, token_hash=token_digest(token), csrf_token=csrf,
        expires_at=now + timedelta(hours=get_settings().session_ttl_hours),
        ip_address=client_ip(request), user_agent=(request.headers.get("user-agent") or "")[:300],
    ))
    db.commit()
    _set_cookie(response, token)
    return serializers.session_payload(user, csrf, load_rules(db).site_timezone)


@router.get("/session")
def session(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return serializers.session_payload(principal.user, principal.session.csrf_token, load_rules(db).site_timezone)


@router.post("/logout", status_code=204)
def logout(response: Response, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Response:
    db.execute(delete(UserSession).where(UserSession.id == principal.session.id))
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/api")
    response.status_code = 204
    return response


@router.post("/password", status_code=204)
def change_password(body: PasswordChangeBody, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Response:
    user = db.get(User, principal.user.id)
    if not verify_password(user.password_hash, body.current_password):
        raise invalid("The current password is incorrect.", {"currentPassword": "The current password is incorrect."})
    problem = password_problem(body.new_password)
    if problem:
        raise invalid(problem, {"newPassword": problem})
    user.password_hash = hash_password(body.new_password)
    # Every other session of this user ends.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.id != principal.session.id))
    audit.record(db, principal, "user.password_changed", "user", user.id, f"{user.full_name} changed their password")
    db.commit()
    return Response(status_code=204)
