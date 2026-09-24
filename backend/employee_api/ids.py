"""UUIDv7 primary keys and the `<prefix>_<uuid7>` form the Triton pipeline
requires for employee, camera, recording and gallery identifiers
(`restaurant_vision.ids.is_id`). Built by hand because Python < 3.14 has no
`uuid.uuid7`; the layout matches the pipeline's own implementation."""
from __future__ import annotations

import secrets
import time
import uuid

PIPELINE_PREFIX = {"employee": "emp", "camera": "cam", "recording": "rec", "gallery": "gal", "run": "run"}


def uuid7() -> uuid.UUID:
    ts = int(time.time() * 1000)
    value = (ts << 80) | (7 << 76) | (secrets.randbits(12) << 64) | (0b10 << 62) | secrets.randbits(62)
    return uuid.UUID(int=value)


def pipeline_id(kind: str, value: uuid.UUID) -> str:
    return f"{PIPELINE_PREFIX[kind]}_{value}"


def parse_pipeline_id(kind: str, value: str | None) -> uuid.UUID | None:
    prefix = PIPELINE_PREFIX[kind] + "_"
    if not value or not value.startswith(prefix):
        return None
    try:
        return uuid.UUID(value[len(prefix):])
    except ValueError:
        return None
