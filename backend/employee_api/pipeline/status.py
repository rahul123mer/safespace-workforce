"""What the administrator sees about the existing recognition pipeline: where
it is, whether its face models are present, their fingerprint and the
threshold profile it applies. Read from files the pipeline owns; nothing here
changes pipeline behaviour."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

from ..config import get_settings

FACE_MODEL_FILES = {"face_detector": "det_10g.onnx", "face_embedder": "w600k_r50.onnx"}


def _model_dir() -> Path | None:
    home = get_settings().insightface_home
    return home / "models" / "buffalo_l" if home else None


@lru_cache(maxsize=8)
def _sha256(path: str, size: int, mtime_ns: int) -> str:  # size/mtime make the cache key change with the file
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_sha256(path: Path) -> str:
    st = path.stat()
    return _sha256(str(path), st.st_size, st.st_mtime_ns)


def model_fingerprint() -> str | None:
    """sha256 over the detector and embedder file hashes, the same material the
    existing backend uses for its gallery `modelManifestSha256`. A registration
    made under a different fingerprint must be re-registered, because its
    embedding came from a different model."""
    model_dir = _model_dir()
    if model_dir is None:
        return None
    try:
        material = "|".join(_file_sha256(model_dir / name) for name in FACE_MODEL_FILES.values())
    except OSError:
        return None
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def threshold_profile() -> dict | None:
    root = get_settings().compute_root
    if root is None:
        return None
    path = root.parent / "contract" / "provenance" / "sc-triton-fr-baseline.json"
    try:
        return dict(json.loads(path.read_text())["inheritedThresholdProfile"])
    except (OSError, KeyError, ValueError):
        return None


def describe() -> dict:
    s = get_settings()
    problems: list[str] = []
    if s.compute_root is None or s.compute_python is None:
        problems.append("EMS_COMPUTE_ROOT and EMS_COMPUTE_PYTHON are not set.")
    else:
        if not (s.compute_root / "restaurant_vision").is_dir():
            problems.append(f"The recognition package was not found under {s.compute_root}.")
        if not s.compute_python.exists():
            problems.append(f"The pipeline interpreter was not found at {s.compute_python}.")
    models = []
    model_dir = _model_dir()
    if model_dir is None:
        problems.append("EMS_INSIGHTFACE_HOME is not set, so the face model files cannot be checked.")
    for role, name in FACE_MODEL_FILES.items():
        path = model_dir / name if model_dir else None
        present = bool(path and path.exists())
        if model_dir is not None and not present:
            problems.append(f"Face model file {name} was not found in {model_dir}.")
        models.append({
            "role": role,
            "name": f"buffalo_l/{name.removesuffix('.onnx')}",
            "present": present,
            "sha256": _file_sha256(path) if present else None,
        })
    return {
        "available": not problems,
        "problems": problems,
        "computeRoot": str(s.compute_root) if s.compute_root else None,
        "allowCpuInference": s.allow_cpu_inference,
        "faceModels": models,
        "modelFingerprint": model_fingerprint(),
        "personDetector": "RF-DETR Medium (rfdetr), selected by the pipeline",
        "tracker": "ByteTrack (roboflow/trackers), selected by the pipeline",
        "thresholdProfile": threshold_profile(),
    }
