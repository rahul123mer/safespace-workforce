"""Request dependencies: the signed-in session, permission checks and CSRF/Origin
protection for every state-changing request."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import ApiError
from .models import User, UserSession
from .security import CSRF_HEADER, SESSION_COOKIE, has_permission, token_digest

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class Principal:
    user: User
    session: UserSession
    ip_address: str | None

    def can(self, permission: str) -> bool:
        return has_permission(self.user.role, permission)


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise ApiError(401, "not_authenticated", "Your session has ended. Sign in again to continue.")
    session = db.scalar(select(UserSession).where(UserSession.token_hash == token_digest(token)))
    now = datetime.now(timezone.utc)
    if session is None or session.expires_at <= now or not session.user.is_active:
        raise ApiError(401, "not_authenticated", "Your session has ended. Sign in again to continue.")

    if request.method in UNSAFE_METHODS:
        origin = request.headers.get("origin")
        if origin and origin not in get_settings().allowed_origins and origin != str(request.base_url).rstrip("/"):
            raise ApiError(403, "origin_rejected", "This request came from an origin that is not allowed to change data.")
        if request.headers.get(CSRF_HEADER) != session.csrf_token:
            raise ApiError(403, "csrf_rejected", "The request could not be verified. Reload the page and try again.")
    return Principal(user=session.user, session=session, ip_address=client_ip(request))


def require(permission: str) -> Callable[..., Principal]:
    def _check(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.can(permission):
            raise ApiError(403, "forbidden", "Your role does not allow this action. Ask an administrator for access.")
        return principal

    return _check
