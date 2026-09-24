"""Face registration through the existing pipeline's per-image enrolment check,
`restaurant_vision.pipeline.face_sample_cli`: InsightFace buffalo_l face
detection, the pipeline's own rejection rules (`no_face`, `multiple_faces`,
`low_detection_score` against the profile's `minFaceDetScore`) and the 512-d
ArcFace embedding. This module adds only the workforce rules on top (minimum
face size, frontal pose, one face per employee) and the bookkeeping."""
from __future__ import annotations

import json
import logging
import math
import struct
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, undefer

from .. import audit, storage
from ..config import get_settings
from ..models import Employee, FaceRegistration
from ..services.rules import load_rules
from .bridge import PipelineUnavailable, run_module
from .status import model_fingerprint

log = logging.getLogger("employee_api.face_registration")

FAILURE_MESSAGES = {
    "no_face": "No face was detected in the uploaded image. Upload a clear image showing one employee face.",
    "multiple_faces": "More than one face was detected. Upload an image that shows only this employee.",
    "low_detection_score": (
        "The face could not be detected with enough confidence. The image may be blurred or poorly lit, "
        "or the face may be partially obstructed or turned away."
    ),
    "face_too_small": "The face is too small in this image. Move closer to the camera or crop the image around the face.",
    "face_not_frontal": "The face is turned to the side. Capture the employee looking directly at the camera.",
    "face_not_turned": "The face is looking straight at the camera. For a side image, ask the employee to turn their head about 30 to 45 degrees.",
    "pose_unclear": "The head direction could not be determined. Retake the image with the whole face visible and the head turned to one side.",
    "same_direction": "This side image is turned the same way as the other side image. Ask the employee to turn their head the other way.",
    "front_required": "Register the front face first. Side images can be added once a front image is registered.",
    "not_same_person": "This image does not appear to show the same person as the registered front image. Check that the right employee is in front of the camera.",
    "unreadable_image": "The image could not be read. Upload a valid JPEG or PNG file.",
    "duplicate_face": "This face closely matches another registered employee. Verify the employee before registering the same face twice.",
    "pipeline_unavailable": "The recognition pipeline is unavailable, so the image could not be checked. Try again once the pipeline is running.",
    "pipeline_error": "The recognition pipeline stopped with an error while checking the image. Try again, and contact an administrator if it keeps failing.",
}


def failure_message(code: str | None) -> str | None:
    return FAILURE_MESSAGES.get(code or "", None) if code else None


def read_npy_float32(path: Path) -> list[float]:
    """Reads the pipeline's `embedding.npy` (float32, shape (512,)) without numpy."""
    data = path.read_bytes()
    if data[:6] != b"\x93NUMPY":
        raise ValueError("embedding file is not in .npy format")
    major = data[6]
    if major == 1:
        header_len = struct.unpack("<H", data[8:10])[0]
        start = 10 + header_len
    else:
        header_len = struct.unpack("<I", data[8:12])[0]
        start = 12 + header_len
    header = data[start - header_len : start].decode("latin-1")
    if "'<f4'" not in header or "'fortran_order': False" not in header:
        raise ValueError(f"unexpected embedding layout: {header.strip()}")
    count = (len(data) - start) // 4
    return list(struct.unpack(f"<{count}f", data[start : start + count * 4]))


def pack_embedding(values: list[float]) -> bytes:
    return struct.pack(f"<{len(values)}f", *values)


def unpack_embedding(blob: bytes) -> list[float]:
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


SLOT_LABELS = {"front": "front", "left": "left-side", "right": "right-side"}


def current_samples(db: Session, employee: Employee) -> dict[str, FaceRegistration]:
    """The employee's registered reference images, by pose slot."""
    rows = db.scalars(select(FaceRegistration).where(
        FaceRegistration.employee_id == employee.id, FaceRegistration.status == "registered"))
    samples = {r.pose_slot: r for r in rows if r.pose_slot != "front"}
    if employee.active_registration_id:
        front = db.get(FaceRegistration, employee.active_registration_id)
        if front is not None and front.status == "registered":
            samples["front"] = front
    return samples


def discard(reg: FaceRegistration, status: str) -> None:
    """Retire a reference image: its file and embedding are deleted, the row is kept as history."""
    reg.status = status
    reg.superseded_at = datetime.now(timezone.utc)
    reg.embedding = None
    storage.delete(reg.image_path)
    reg.image_path = None


def _fail(db: Session, reg: FaceRegistration, employee: Employee, code: str, detail: str | None = None) -> None:
    reg.status = "failed"
    reg.failure_reason = code
    reg.failure_detail = detail
    reg.completed_at = datetime.now(timezone.utc)
    if reg.pose_slot == "front":
        # A failed replacement leaves the employee's current registration in force.
        employee.face_status = "registered" if employee.active_registration_id else "failed"
    storage.delete(reg.image_path)
    reg.image_path = None
    audit.record(db, None, "face.registration_failed", "employee", employee.id,
                 f"{SLOT_LABELS[reg.pose_slot].capitalize()} face image for {employee.full_name} ({employee.employee_code}) failed: {code}",
                 {"registrationId": str(reg.id), "poseSlot": reg.pose_slot, "reason": code})


def _closest_other(db: Session, employee_id: uuid.UUID, embedding: list[float]) -> tuple[Employee, float] | None:
    """Most similar registered reference image (any pose) of any other employee."""
    rows = db.execute(
        select(FaceRegistration, Employee)
        .join(Employee, Employee.id == FaceRegistration.employee_id)
        .where(Employee.id != employee_id, FaceRegistration.status == "registered")
        .options(undefer(FaceRegistration.embedding))
    ).all()
    best: tuple[Employee, float] | None = None
    for reg, other in rows:
        if not reg.embedding:
            continue
        sim = cosine(embedding, unpack_embedding(reg.embedding))
        if best is None or sim > best[1]:
            best = (other, sim)
    return best


def _check_pose(db: Session, reg: FaceRegistration, employee: Employee, rules, embedding: list[float]) -> tuple[str, str | None] | None:
    """Slot-specific checks. Returns (failure code, detail) or None when the image fits its slot.

    The pipeline classifies pose from where the nose sits in the image, so "left" and
    "right" are image directions and depend on camera mirroring. Side images are
    therefore required to be turned (not frontal) and to face opposite ways, rather
    than to match a particular label."""
    if reg.pose_slot == "front":
        if rules.require_frontal_face and reg.head_pose != "front":
            return "face_not_frontal", None
        return None
    if reg.head_pose == "front":
        return "face_not_turned", None
    if reg.head_pose not in ("left", "right"):
        return "pose_unclear", None
    samples = current_samples(db, employee)
    front = samples.get("front")
    if front is None:
        return "front_required", None
    other_slot = "right" if reg.pose_slot == "left" else "left"
    other = samples.get(other_slot)
    if other is not None and other.head_pose == reg.head_pose:
        return "same_direction", f"The {SLOT_LABELS[other_slot]} image is turned the same way."
    front_embedding = db.scalar(select(FaceRegistration.embedding).where(FaceRegistration.id == front.id))
    if front_embedding:
        sim = cosine(embedding, unpack_embedding(front_embedding))
        if sim < rules.side_match_min_similarity:
            return "not_same_person", (f"Similarity {sim:.2f} to the registered front image; "
                                       f"at least {rules.side_match_min_similarity:.2f} is required.")
    return None


def process(db: Session, registration_id: uuid.UUID) -> None:
    reg = db.get(FaceRegistration, registration_id)
    if reg is None or reg.status != "processing":
        return
    employee = db.get(Employee, reg.employee_id)
    rules = load_rules(db).registration
    image = storage.resolve(reg.image_path) if reg.image_path else None
    if image is None or not image.exists():
        _fail(db, reg, employee, "unreadable_image", "The stored image is missing.")
        return

    with tempfile.TemporaryDirectory(prefix="ems-face-") as tmp:
        out = Path(tmp) / "out"
        try:
            proc = run_module(
                "restaurant_vision.pipeline.face_sample_cli",
                ["--image", str(image), "--out", str(out)],
                timeout=get_settings().face_registration_timeout_s,
            )
        except PipelineUnavailable as exc:
            _fail(db, reg, employee, "pipeline_unavailable", str(exc))
            return
        except subprocess.TimeoutExpired:
            _fail(db, reg, employee, "pipeline_error", "The face check did not finish within the configured timeout.")
            return
        result_path = out / "result.json"
        result = json.loads(result_path.read_text()) if result_path.exists() else None
        if result is None or "modelUnavailable" in result or proc.returncode != 0:
            detail = (result or {}).get("modelUnavailable") or (proc.stderr or "").strip()[-600:] or f"exit code {proc.returncode}"
            code = "pipeline_unavailable" if proc.returncode == 3 or (result and "modelUnavailable" in result) else "pipeline_error"
            log.error("face_sample_cli failed for registration %s: %s", reg.id, detail)
            _fail(db, reg, employee, code, detail)
            return

        reg.det_score = result.get("detScore")
        reg.face_size_px = result.get("faceSizePx")
        reg.head_pose = result.get("headPose")
        if not result.get("accepted"):
            _fail(db, reg, employee, result.get("rejectionReason") or "no_face")
            return
        if (reg.face_size_px or 0) < rules.min_face_size_px:
            _fail(db, reg, employee, "face_too_small",
                  f"The face measures {reg.face_size_px} px; at least {rules.min_face_size_px} px is required.")
            return
        embedding = read_npy_float32(Path(result["embeddingPath"]))

    pose_problem = _check_pose(db, reg, employee, rules, embedding)
    if pose_problem:
        _fail(db, reg, employee, *pose_problem)
        return

    closest = _closest_other(db, employee.id, embedding)
    if closest and closest[1] >= rules.duplicate_similarity_threshold:
        other, sim = closest
        _fail(db, reg, employee, "duplicate_face",
              f"Similarity {sim:.2f} to {other.full_name} ({other.employee_code}); the limit is {rules.duplicate_similarity_threshold:.2f}.")
        return

    now = datetime.now(timezone.utc)
    previous = current_samples(db, employee).get(reg.pose_slot)
    if previous is not None and previous.id != reg.id:
        # One image per pose is kept: the replaced image and embedding are deleted.
        discard(previous, "superseded")
    reg.status = "registered"
    reg.embedding = pack_embedding(embedding)
    reg.model_fingerprint = model_fingerprint()
    reg.completed_at = now
    if reg.pose_slot == "front":
        employee.active_registration_id = reg.id
        employee.face_status = "registered"
        employee.face_registered_at = now
        employee.reregistration_requested = False
        employee.reregistration_reason = None
    audit.record(db, None, "face.registered", "employee", employee.id,
                 f"{SLOT_LABELS[reg.pose_slot].capitalize()} face image registered for {employee.full_name} ({employee.employee_code})",
                 {"registrationId": str(reg.id), "poseSlot": reg.pose_slot, "replaced": str(previous.id) if previous else None})
