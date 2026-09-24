from helpers import analyse, create_camera, create_employee, create_shift, register_face


def _setup(admin, monkeypatch, name="Rahul Sharma", code="SSG-7001", seed=11):
    shift = create_shift(admin, "General Day", "09:00", "18:00", 10)
    emp = create_employee(admin, code, name, shift["id"])
    register_face(admin, monkeypatch, emp["id"], seed=seed)
    entry = create_camera(admin, "CAM-ENT-01", "Main Entrance Camera", "entry")
    exit_ = create_camera(admin, "CAM-EXT-01", "Exit Corridor Camera", "exit")
    return emp, entry, exit_


def test_entry_and_exit_footage_produce_in_and_out(admin, monkeypatch):
    emp, entry, exit_ = _setup(admin, monkeypatch)
    rec = analyse(admin, monkeypatch, entry["id"], "2026-09-21T08:55:00",
                  [{"label": "Rahul Sharma", "startMs": 120_000, "endMs": 135_000, "similarity": 0.71}])
    assert rec["status"] == "completed" and rec["eventsConfirmed"] == 1 and rec["galleryEmployeeCount"] == 1
    analyse(admin, monkeypatch, exit_["id"], "2026-09-21T18:10:00",
            [{"label": "Rahul Sharma", "startMs": 200_000, "endMs": 250_000, "similarity": 0.66}])

    events = admin.get("/events", params={"dateFrom": "2026-09-21"}).json()
    by_type = {e["eventType"]: e for e in events["items"]}
    assert by_type["in"]["occurredAt"].startswith("2026-09-21T08:57:00")       # first seen on the entry camera
    assert by_type["out"]["occurredAt"].startswith("2026-09-21T18:14:10")      # last seen on the exit camera
    assert by_type["in"]["camera"]["name"] == "Main Entrance Camera" and by_type["in"]["confidence"] == 0.71

    att = admin.get("/attendance", params={"dateFrom": "2026-09-21"}).json()
    row = att["items"][0]
    assert row["status"] == "completed" and row["durationMinutes"] == 557 and row["lateMinutes"] is None
    assert row["entryCamera"]["name"] == "Main Entrance Camera" and row["exitCamera"]["name"] == "Exit Corridor Camera"


def test_missing_exit_is_never_fabricated_and_late_arrival_is_flagged(admin, monkeypatch):
    emp, entry, _ = _setup(admin, monkeypatch)
    analyse(admin, monkeypatch, entry["id"], "2026-09-20T09:30:00",
            [{"label": "Rahul Sharma", "startMs": 0, "endMs": 5_000}])
    row = admin.get("/attendance", params={"dateFrom": "2026-09-20"}).json()["items"][0]
    assert row["outAt"] is None and row["durationMinutes"] is None
    assert row["status"] == "exit_not_recorded" and row["lateMinutes"] == 20
    # An old IN without an OUT is not evidence that the employee left.
    assert admin.get(f"/employees/{emp['id']}").json()["presence"] == "exit_not_recorded"
    m = admin.get("/dashboard").json()["metrics"]
    assert m["currentlyIn"] == 0 and m["currentlyOut"] == 0


def test_duplicate_and_review_rules(admin, monkeypatch):
    emp, entry, exit_ = _setup(admin, monkeypatch)
    other_entry = create_camera(admin, "CAM-ENT-09", "Service Gate", "entry")
    analyse(admin, monkeypatch, entry["id"], "2026-09-19T09:00:00", [
        {"label": "Rahul Sharma", "startMs": 0, "endMs": 4_000},
        {"label": "Rahul Sharma", "startMs": 60_000, "endMs": 64_000},          # 1 minute later: duplicate
        {"label": "Rahul Sharma", "status": "review", "startMs": 900_000, "endMs": 905_000},
    ])
    analyse(admin, monkeypatch, other_entry["id"], "2026-09-19T12:00:00", [{"label": "Rahul Sharma", "startMs": 0, "endMs": 3_000}])
    counts = admin.get("/events", params={"dateFrom": "2026-09-19"}).json()["statusCounts"]
    # Every enabled entry camera records IN for every registered employee; the
    # Service Gate IN three hours later is a second confirmed entry.
    assert counts == {"confirmed": 2, "needs_review": 1, "rejected": 0, "duplicate": 1}

    pending = admin.get("/events", params={"dateFrom": "2026-09-19", "status": "needs_review"}).json()["items"][0]
    r = admin.post(f"/events/{pending['id']}/review", json={"decision": "reject"})
    assert r.json()["status"] == "rejected"
    r = admin.post(f"/events/{pending['id']}/review", json={"decision": "confirm"})
    assert r.status_code == 409


def test_entry_exit_camera_alternates_in_and_out(admin, monkeypatch):
    emp = create_employee(admin, "SSG-7002", "Aditi Kulkarni")
    register_face(admin, monkeypatch, emp["id"], seed=12)
    gate = create_camera(admin, "CAM-GATE-01", "Reception Gate", "entry_exit")
    analyse(admin, monkeypatch, gate["id"], "2026-09-18T08:00:00", [
        {"label": "Aditi Kulkarni", "startMs": 3_600_000, "endMs": 3_610_000},    # 09:00 IN
        {"label": "Aditi Kulkarni", "startMs": 34_200_000, "endMs": 34_210_000},  # 17:30 OUT
    ])
    events = admin.get("/events", params={"dateFrom": "2026-09-18"}).json()["items"]
    assert [e["eventType"] for e in reversed(events)] == ["in", "out"]


def test_footage_without_registered_faces_fails_with_explanation(admin, monkeypatch):
    cam = create_camera(admin, "CAM-ENT-03", "Staff Entrance", "entry")
    rec = analyse(admin, monkeypatch, cam["id"], "2026-09-17T09:00:00", [])
    assert rec["status"] == "failed" and rec["failureCode"] == "gallery_empty"
    assert rec["failureMessage"].startswith("No active employee has a registered face")


def test_footage_upload_validation(admin):
    cam = create_camera(admin, "CAM-ENT-04", "North Lobby", "entry")
    r = admin.post(f"/cameras/{cam['id']}/footage", files={"file": ("notes.txt", b"hello", "text/plain")},
                   data={"captureStartedAt": "2026-09-17T09:00:00"})
    assert r.status_code == 415
    r = admin.post(f"/cameras/{cam['id']}/footage", files={"file": ("clip.mp4", b"not a video at all....", "video/mp4")},
                   data={"captureStartedAt": "2026-09-17T09:00:00"})
    assert r.status_code == 415
    r = admin.post(f"/cameras/{cam['id']}/footage", files={"file": ("clip.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4")},
                   data={"captureStartedAt": "2099-01-01T09:00:00"})
    assert r.status_code == 422


def test_dashboard_reflects_presence_and_configuration(admin, monkeypatch):
    emp, entry, exit_ = _setup(admin, monkeypatch)
    create_employee(admin, "SSG-7003", "Pooja Sinha")
    admin.post(f"/cameras/{create_camera(admin, 'CAM-X', 'Warehouse Door', 'exit', source=None)['id']}/enabled", json={"enabled": True})
    data = admin.get("/dashboard").json()
    m = data["metrics"]
    assert m["totalEmployees"] == 2 and m["activeEmployees"] == 2
    assert m["faceRegistered"] == 1 and m["faceRegistrationPending"] == 1
    assert m["configuredCameras"] == 3 and m["camerasWithIssues"] == 1
    assert m["currentlyIn"] == 0 and data["recentEvents"] == []


def test_settings_rules_drive_processing(admin, monkeypatch):
    rules = admin.get("/settings").json()["rules"]
    rules["siteTimezone"] = "Asia/Kolkata"
    r = admin.put("/settings/rules", json=rules)
    assert r.status_code == 200 and r.json()["rules"]["siteTimezone"] == "Asia/Kolkata"
    bad = admin.put("/settings/rules", json={**rules, "siteTimezone": "Mars/Olympus"})
    assert bad.status_code == 422

    emp = create_employee(admin, "SSG-7004", "Nikhil Jain")
    register_face(admin, monkeypatch, emp["id"], seed=14)
    cam = create_camera(admin, "CAM-ENT-05", "Side Entrance", "entry")
    analyse(admin, monkeypatch, cam["id"], "2026-09-16T09:05:00", [{"label": "Nikhil Jain", "startMs": 0, "endMs": 2_000}])
    ev = admin.get("/events", params={"dateFrom": "2026-09-16"}).json()["items"][0]
    assert ev["status"] == "confirmed" and ev["occurredAt"] == "2026-09-16T03:35:00+00:00"   # 09:05 IST
