import json

from conftest import drain_jobs, png_bytes
from helpers import create_employee, register_face


def test_successful_registration_stores_embedding_but_never_returns_it(admin, monkeypatch):
    emp = create_employee(admin, "SSG-6001", "Ananya Kapoor")
    reg = register_face(admin, monkeypatch, emp["id"], seed=1)
    assert reg["status"] == "registered" and reg["isCurrent"] and reg["faceSizePx"] == 180
    detail = admin.get(f"/employees/{emp['id']}").json()
    assert detail["faceStatus"] == "registered" and detail["faceRegisteredAt"]
    assert "embedding" not in json.dumps(detail).lower()
    img = admin.get(f"/face-registrations/{reg['id']}/image")
    assert img.status_code == 200 and img.headers["cache-control"] == "no-store, private"

    from employee_api.db import new_session
    from employee_api.models import FaceRegistration
    with new_session() as db:
        assert len(db.get(FaceRegistration, reg["id"]).embedding) == 512 * 4


def test_viewer_cannot_see_face_images(admin, viewer, monkeypatch):
    emp = create_employee(admin, "SSG-6002", "Farhan Qureshi")
    reg = register_face(admin, monkeypatch, emp["id"], seed=2)
    assert viewer.get(f"/face-registrations/{reg['id']}/image").status_code == 403


def test_upload_validation(admin):
    emp = create_employee(admin, "SSG-6003", "Sneha Pillai")
    url = f"/employees/{emp['id']}/face-registrations"
    r = admin.post(url, files={"image": ("face.gif", b"GIF89a....", "image/gif")})
    assert r.status_code == 415 and r.json()["error"]["message"] == "Unsupported file type. Upload a JPEG or PNG image."
    r = admin.post(url, files={"image": ("face.png", b"not really an image", "image/png")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_image"
    r = admin.post(url, files={"image": ("face.png", png_bytes(24, 24), "image/png")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "image_too_small"


def test_pipeline_rejections_are_explained(admin, monkeypatch):
    emp = create_employee(admin, "SSG-6004", "Deepak Verma")
    reg = register_face(admin, monkeypatch, emp["id"], seed=3, accepted=False, rejectionReason="no_face")
    assert reg["status"] == "failed"
    assert reg["failureMessage"] == "No face was detected in the uploaded image. Upload a clear image showing one employee face."
    assert admin.get(f"/employees/{emp['id']}").json()["faceStatus"] == "failed"
    reg = register_face(admin, monkeypatch, emp["id"], seed=3, accepted=False, rejectionReason="multiple_faces")
    assert reg["failureReason"] == "multiple_faces"
    reg = register_face(admin, monkeypatch, emp["id"], seed=3, faceSizePx=52)
    assert reg["failureReason"] == "face_too_small" and "52 px" in reg["failureDetail"]
    reg = register_face(admin, monkeypatch, emp["id"], seed=3, headPose="left")
    assert reg["failureReason"] == "face_not_frontal"
    assert reg["imageAvailable"] is False  # rejected images are not kept


def test_replacing_requires_confirmation_and_failure_keeps_current_face(admin, monkeypatch):
    emp = create_employee(admin, "SSG-6005", "Ishaan Bose")
    first = register_face(admin, monkeypatch, emp["id"], seed=4)
    r = admin.post(f"/employees/{emp['id']}/face-registrations", files={"image": ("face.png", png_bytes(), "image/png")})
    assert r.status_code == 409 and r.json()["error"]["message"].startswith("A face is already registered for this employee.")

    failed = register_face(admin, monkeypatch, emp["id"], seed=4, replace=True, accepted=False, rejectionReason="low_detection_score")
    assert failed["status"] == "failed"
    detail = admin.get(f"/employees/{emp['id']}").json()
    assert detail["faceStatus"] == "registered" and detail["faceRegistration"]["id"] == first["id"]

    second = register_face(admin, monkeypatch, emp["id"], seed=5, replace=True)
    history = {r["id"]: r for r in admin.get(f"/employees/{emp['id']}/face-registrations").json()["items"]}
    assert history[second["id"]]["isCurrent"] and history[first["id"]]["status"] == "superseded"
    assert history[first["id"]]["imageAvailable"] is False  # replaced biometric data is deleted


def test_same_face_cannot_be_registered_to_two_employees(admin, monkeypatch):
    a = create_employee(admin, "SSG-6006", "Kavya Reddy")
    b = create_employee(admin, "SSG-6007", "Manoj Pandey")
    register_face(admin, monkeypatch, a["id"], seed=7)
    reg = register_face(admin, monkeypatch, b["id"], seed=7)
    assert reg["failureReason"] == "duplicate_face" and "Kavya Reddy" in reg["failureDetail"]


def test_pipeline_unavailable_is_reported(admin, monkeypatch):
    emp = create_employee(admin, "SSG-6008", "Tanvi Agarwal")
    reg = register_face(admin, monkeypatch, emp["id"], seed=8, modelUnavailable="buffalo_l model file missing")
    assert reg["failureReason"] == "pipeline_unavailable" and "buffalo_l" in reg["failureDetail"]


def test_model_change_requires_reregistration_and_removal_deletes_data(admin, monkeypatch, tmp_path):
    emp = create_employee(admin, "SSG-6009", "Siddharth Rao")
    reg = register_face(admin, monkeypatch, emp["id"], seed=9)
    from employee_api.config import get_settings
    model = get_settings().insightface_home / "models" / "buffalo_l" / "w600k_r50.onnx"
    original = model.read_bytes()
    try:
        model.write_bytes(b"updated-embedder-model")
        detail = admin.get(f"/employees/{emp['id']}").json()
        assert detail["faceStatus"] == "requires_reregistration"
        assert admin.get("/employees", params={"faceStatus": "requires_reregistration"}).json()["total"] == 1
    finally:
        model.write_bytes(original)
    assert admin.get(f"/employees/{emp['id']}").json()["faceStatus"] == "registered"

    admin.post(f"/employees/{emp['id']}/face/reregistration-request", json={"reason": "Employee changed appearance significantly"})
    assert admin.get(f"/employees/{emp['id']}").json()["faceStatus"] == "requires_reregistration"

    assert admin.delete(f"/employees/{emp['id']}/face").status_code == 204
    assert admin.get(f"/employees/{emp['id']}").json()["faceStatus"] == "not_registered"
    assert admin.get(f"/face-registrations/{reg['id']}/image").status_code == 404


def test_inactive_employee_cannot_register_face(admin):
    emp = create_employee(admin, "SSG-6010", "Rhea Malhotra")
    admin.post(f"/employees/{emp['id']}/status", json={"status": "inactive"})
    r = admin.post(f"/employees/{emp['id']}/face-registrations", files={"image": ("face.png", png_bytes(), "image/png")})
    assert r.status_code == 409 and r.json()["error"]["code"] == "employee_inactive"
    drain_jobs()


def test_side_images_require_front_and_opposite_turned_faces(admin, monkeypatch):
    emp = create_employee(admin, "SSG-6011", "Vivek Menon")
    url = f"/employees/{emp['id']}/face-registrations"
    r = admin.post(url, files={"image": ("face.png", png_bytes(), "image/png")}, data={"poseSlot": "left"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "front_required"

    register_face(admin, monkeypatch, emp["id"], seed=21)
    # A frontal face is not a side image.
    reg = register_face(admin, monkeypatch, emp["id"], seed=21, slot="left", headPose="front")
    assert reg["failureReason"] == "face_not_turned"
    left = register_face(admin, monkeypatch, emp["id"], seed=21, slot="left", headPose="left")
    assert left["status"] == "registered" and left["poseSlot"] == "left"
    # The right image must be turned the other way from the left one.
    reg = register_face(admin, monkeypatch, emp["id"], seed=21, slot="right", headPose="left")
    assert reg["failureReason"] == "same_direction"
    # A different person's face is refused for a side slot.
    reg = register_face(admin, monkeypatch, emp["id"], seed=22, slot="right", headPose="right")
    assert reg["failureReason"] == "not_same_person"
    right = register_face(admin, monkeypatch, emp["id"], seed=21, slot="right", headPose="right")
    assert right["status"] == "registered"

    samples = admin.get(f"/employees/{emp['id']}").json()["faceSamples"]
    assert {k: (v["current"] or {}).get("id") for k, v in samples.items()} == {
        "front": samples["front"]["current"]["id"], "left": left["id"], "right": right["id"]}
    # Side failures never change the employee's overall face status.
    assert admin.get(f"/employees/{emp['id']}").json()["faceStatus"] == "registered"

    r = admin.post(url, files={"image": ("face.png", png_bytes(), "image/png")}, data={"poseSlot": "left"})
    assert r.status_code == 409 and "left-side image is already registered" in r.json()["error"]["message"]

    assert admin.delete(f"/employees/{emp['id']}/face/left").status_code == 204
    assert admin.get(f"/employees/{emp['id']}").json()["faceSamples"]["left"]["current"] is None
    assert admin.delete(f"/employees/{emp['id']}/face/front").status_code == 422

    assert admin.delete(f"/employees/{emp['id']}/face").status_code == 204
    after = admin.get(f"/employees/{emp['id']}").json()
    assert after["faceStatus"] == "not_registered" and after["faceSamples"]["right"]["current"] is None
    assert admin.get(f"/face-registrations/{right['id']}/image").status_code == 404


def test_side_image_of_another_employee_is_a_duplicate(admin, monkeypatch):
    a = create_employee(admin, "SSG-6012", "Anjali Desai")
    b = create_employee(admin, "SSG-6013", "Karthik Iyer")
    register_face(admin, monkeypatch, a["id"], seed=31)
    register_face(admin, monkeypatch, a["id"], seed=31, slot="left", headPose="left")
    reg = register_face(admin, monkeypatch, b["id"], seed=31)
    assert reg["failureReason"] == "duplicate_face" and "Anjali Desai" in reg["failureDetail"]
