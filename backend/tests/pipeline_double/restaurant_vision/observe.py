"""TEST DOUBLE of the existing `python -m restaurant_vision.observe`.

Used only by the backend test suite. It accepts the real CLI's arguments,
reads the gallery the backend builds (`<dir>/emp_<uuid7>/sample.*` plus
`labels.json`) and writes `run_result.json`, `track_summaries.json` and
`identity_decisions.json` in the real pipeline's shapes. Which employees are
"seen", and when, comes from the TEST_OBSERVE_SCRIPT environment variable:
a JSON list of {"label", "status", "startMs", "endMs", "similarity"}."""
from __future__ import annotations

import argparse
import json
import os
import uuid
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    for flag in ("--video", "--camera-id", "--recording-id", "--run-id", "--out", "--gallery", "--gallery-version-id"):
        p.add_argument(flag)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--allow-cpu", action="store_true")
    args = p.parse_args()
    if os.environ.get("TEST_OBSERVE_FAIL"):
        return 3
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    labels = json.loads((Path(args.gallery) / "labels.json").read_text()) if args.gallery else {}
    by_label = {v: k for k, v in labels.items()}
    script = json.loads(os.environ.get("TEST_OBSERVE_SCRIPT", "[]"))
    summaries, decisions = [], []
    for item in script:
        seg_id, trk_id = f"tseg_{uuid.uuid4()}", f"trk_{uuid.uuid4()}"
        summaries.append({"trackId": trk_id, "cameraId": args.camera_id, "recordingId": args.recording_id,
                          "firstSourceMs": item["startMs"], "lastSourceMs": item["endMs"],
                          "segments": [{"trackSegmentId": seg_id, "startSourceMs": item["startMs"],
                                        "endSourceMs": item["endMs"], "startReason": "track_start"}]})
        emp = by_label.get(item["label"])
        status = item.get("status", "auto")
        decisions.append({
            "identityDecisionId": f"idd_{uuid.uuid4()}", "trackSegmentId": seg_id, "trackId": trk_id,
            "galleryVersionId": args.gallery_version_id, "method": "frame_vote", "status": status,
            "employeeId": emp if status == "auto" else None,
            "candidates": [{"employeeId": emp, "bestFrameSimilarity": item.get("similarity", 0.7),
                            "pooledSimilarity": item.get("similarity", 0.7) - 0.05, "supportingFaces": 5}] if emp else [],
        })
    (out / "track_summaries.json").write_text(json.dumps(summaries))
    (out / "identity_decisions.json").write_text(json.dumps(decisions))
    (out / "run_result.json").write_text(json.dumps({"runId": args.run_id, "media": {"durationMs": 60000}, "degraded": []}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
