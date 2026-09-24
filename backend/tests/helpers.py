from __future__ import annotations

import json

from conftest import MP4_BYTES, drain_jobs, png_bytes


def create_shift(api, name="General Day", start="09:00", end="18:00", grace=10, days=(1, 2, 3, 4, 5)):
    r = api.post("/shifts", json={"name": name, "shiftType": "general", "startTime": start, "endTime": end,
                                  "gracePeriodMinutes": grace, "workingDays": list(days)})
    assert r.status_code == 201, r.text
    return r.json()


def create_employee(api, code, name, shift_id=None, department="Operations"):
    r = api.post("/employees", json={
        "employeeCode": code, "fullName": name, "email": f"{code.lower()}@safespaceglobal.ai", "phone": "+91 98450 12345",
        "department": department, "designation": "Operations Executive", "employmentType": "full_time",
        "joiningDate": "2025-04-01", "status": "active", "shiftId": shift_id,
    })
    assert r.status_code == 201, r.text
    return r.json()


def create_camera(api, code, name, direction, source="rtsp://nvr.local:554/stream1"):
    r = api.post("/cameras", json={"cameraCode": code, "name": name, "location": f"{name} area", "cameraType": "dome",
                                   "direction": direction, "sourceUrl": source})
    assert r.status_code == 201, r.text
    return r.json()


def register_face(api, monkeypatch, employee_id, seed, *, replace=False, slot="front", **spec):
    monkeypatch.setenv("TEST_FACE_RESULT", json.dumps({"embeddingSeed": seed, **spec}))
    r = api.post(f"/employees/{employee_id}/face-registrations",
                 files={"image": ("face.png", png_bytes(), "image/png")},
                 data={"captureMethod": "upload", "poseSlot": slot, "replaceExisting": "true" if replace else "false"})
    assert r.status_code == 202, r.text
    drain_jobs()
    return api.get(f"/face-registrations/{r.json()['id']}").json()


def analyse(api, monkeypatch, camera_id, started_local, script):
    monkeypatch.setenv("TEST_OBSERVE_SCRIPT", json.dumps(script))
    r = api.post(f"/cameras/{camera_id}/footage", files={"file": ("export.mp4", MP4_BYTES + started_local.encode(), "video/mp4")},
                 data={"captureStartedAt": started_local})
    assert r.status_code == 202, r.text
    drain_jobs()
    return api.get(f"/footage/{r.json()['id']}").json()
