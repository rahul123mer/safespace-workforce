"""TEST DOUBLE of the existing `restaurant_vision.pipeline.face_sample_cli`.

Used only by the backend test suite (tests/conftest.py points EMS_COMPUTE_ROOT
here). It reproduces the real CLI's arguments, exit codes and output files
(`result.json`, `embedding.npy`) so the backend's integration code is exercised
end to end; the face decision itself comes from the TEST_FACE_RESULT
environment variable set by each test. It is never used outside tests."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
from pathlib import Path


def _write_npy(path: Path, values: list[float]) -> None:
    header = "{'descr': '<f4', 'fortran_order': False, 'shape': (%d,), }" % len(values)
    header = header + " " * (63 - (len(header) + 10) % 64) + "\n"
    path.write_bytes(b"\x93NUMPY\x01\x00" + struct.pack("<H", len(header)) + header.encode("latin-1")
                     + struct.pack(f"<{len(values)}f", *values))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--allow-cpu", action="store_true")
    args = p.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    spec = json.loads(os.environ.get("TEST_FACE_RESULT", "{}"))
    if spec.get("modelUnavailable"):
        (out / "result.json").write_text(json.dumps({"modelUnavailable": spec["modelUnavailable"]}))
        return 3
    result = {
        "accepted": spec.get("accepted", True),
        "rejectionReason": spec.get("rejectionReason"),
        "detScore": spec.get("detScore", 0.82),
        "faceSizePx": spec.get("faceSizePx", 180),
        # Without an explicit pose, the slot prefix of the stored file name stands in for the
        # detected direction (front-*, left-*, right-*); the real CLI measures it from landmarks.
        "headPose": spec.get("headPose") or next((x for x in ("left", "right") if Path(args.image).name.startswith(x + "-")), "front"),
        "embeddingPath": None,
    }
    if result["accepted"]:
                # Without an explicit seed, one direction per stored employee folder (same person, same face).
        seed = int(spec["embeddingSeed"]) if "embeddingSeed" in spec else int(hashlib.sha256(Path(args.image).parent.name.encode()).hexdigest(), 16)
        vector = [0.0] * 512
        vector[seed % 512] = 1.0
        _write_npy(out / "embedding.npy", vector)
        result["embeddingPath"] = str(out / "embedding.npy")
    (out / "result.json").write_text(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
