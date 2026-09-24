"""Administrative audit trail. Callers pass only descriptive fields; images,
embeddings, passwords and stream credentials are never recorded."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .deps import Principal
from .models import AuditEntry

REDACTED_KEYS = {"password", "password_hash", "embedding", "source_url", "sourceUrl"}


def _clean(changes: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in changes.items():
        if key in REDACTED_KEYS:
            out[key] = "changed"
        elif isinstance(value, dict):
            out[key] = _clean(value)
        else:
            out[key] = value
    return out


def record(
    db: Session,
    principal: Principal | None,
    action: str,
    target_type: str,
    target_id: uuid.UUID | None,
    summary: str,
    changes: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditEntry(
            actor_user_id=principal.user.id if principal else None,
            actor_label=f"{principal.user.full_name} <{principal.user.email}>" if principal else "Recognition worker",
            action=action,
            target_type=target_type,
            target_id=target_id,
            summary=summary[:300],
            changes=_clean(changes or {}),
            ip_address=principal.ip_address if principal else None,
        )
    )


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """`{field: {"from": old, "to": new}}` for fields whose value changed."""
    return {k: {"from": before.get(k), "to": v} for k, v in after.items() if before.get(k) != v}
