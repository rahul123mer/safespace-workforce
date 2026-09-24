from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..deps import Principal, require
from ..pipeline import status as pipeline_status
from ..services.rules import SystemRules, load_rules, save_rules

router = APIRouter(prefix="/settings", tags=["settings"])


def _payload(rules: SystemRules, principal: Principal) -> dict:
    s = get_settings()
    data = {
        "rules": rules.model_dump(mode="json", by_alias=True),
        "limits": {"maxFaceImageBytes": s.max_face_image_bytes, "maxFootageBytes": s.max_footage_bytes,
                   "sessionTtlHours": s.session_ttl_hours},
        "canEdit": principal.can("settings.manage"),
    }
    if principal.can("settings.manage"):
        data["pipeline"] = pipeline_status.describe()
    return data


@router.get("")
def get_settings_view(principal: Principal = Depends(require("settings.view")), db: Session = Depends(get_db)) -> dict:
    return _payload(load_rules(db), principal)


@router.put("/rules")
def update_rules(body: SystemRules, principal: Principal = Depends(require("settings.manage")), db: Session = Depends(get_db)) -> dict:
    before = load_rules(db).model_dump(mode="json", by_alias=True)
    after = body.model_dump(mode="json", by_alias=True)
    changes = {}
    for section in ("attendance", "registration"):
        changes.update({f"{section}.{k}": v for k, v in audit.diff(before[section], after[section]).items()})
    if before["siteTimezone"] != after["siteTimezone"]:
        changes["siteTimezone"] = {"from": before["siteTimezone"], "to": after["siteTimezone"]}
    save_rules(db, body, principal.user.id)
    if changes:
        audit.record(db, principal, "settings.updated", "settings", None, f"Updated {', '.join(changes)}", changes)
    db.commit()
    return _payload(body, principal)
