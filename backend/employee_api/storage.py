"""Local file storage for face images and imported footage, plus a
dependency-free image header check. The header parser follows the one in the
existing Triton backend (`restaurant_api/core/face_quality.py`), so both
applications classify unreadable and undersized uploads identically."""
from __future__ import annotations

import hashlib
import os
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path

from .config import get_settings

ACCEPTED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}
MIN_IMAGE_EDGE_PX = 40


def root() -> Path:
    path = get_settings().storage_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve(relative: str) -> Path:
    """Absolute path for a stored relative key; refuses anything outside storage."""
    base = root().resolve()
    path = (base / relative).resolve()
    if base != path and base not in path.parents:
        raise ValueError("storage path escapes the storage root")
    return path


def write_bytes(relative: str, data: bytes) -> Path:
    path = resolve(relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)
    return path


def delete(relative: str | None) -> None:
    if not relative:
        return
    try:
        resolve(relative).unlink(missing_ok=True)
    except ValueError:
        pass


def delete_tree(relative: str) -> None:
    shutil.rmtree(resolve(relative), ignore_errors=True)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class ImageInfo:
    media_type: str
    width: int
    height: int


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    i, n = 2, len(data)
    while i + 4 <= n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD9:
            i += 2
            continue
        seg_len = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if i + 9 > n:
                return None
            height, width = struct.unpack(">HH", data[i + 5 : i + 9])
            return width, height
        if seg_len < 2:
            return None
        i += 2 + seg_len
    return None


def inspect_image(data: bytes) -> ImageInfo | None:
    """JPEG/PNG type and pixel size from the file header, or None if the bytes
    are not a readable JPEG or PNG."""
    dims: tuple[int, int] | None = None
    media_type = None
    if data[:3] == b"\xff\xd8\xff":
        media_type, dims = "image/jpeg", _jpeg_dimensions(data)
    elif data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        media_type, dims = "image/png", struct.unpack(">II", data[16:24])
    if media_type is None or dims is None or dims[0] <= 0 or dims[1] <= 0:
        return None
    return ImageInfo(media_type, int(dims[0]), int(dims[1]))
