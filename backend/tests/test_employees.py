from helpers import create_camera, create_employee, create_shift


def test_create_update_deactivate_employee_with_history(admin):
    shift = create_shift(admin)
    emp = create_employee(admin, "SSG-1042", "Priya Raman", shift["id"])
    assert emp["faceStatus"] == "not_registered" and emp["shift"]["name"] == "General Day" and emp["presence"] == "no_activity"

    body = {k: emp[k] for k in ("employeeCode", "fullName", "email", "phone", "department", "designation", "employmentType", "joiningDate")}
    r = admin.patch(f"/employees/{emp['id']}", json={**body, "designation": "Shift Supervisor", "shiftId": shift["id"]})
    assert r.status_code == 200 and r.json()["designation"] == "Shift Supervisor"

    r = admin.post(f"/employees/{emp['id']}/status", json={"status": "inactive", "reason": "Transferred to the Pune site"})
    assert r.json()["status"] == "inactive" and r.json()["deactivatedAt"]
    assert admin.get(f"/employees/{emp['id']}").status_code == 200  # never deleted

    actions = [h["action"] for h in admin.get(f"/employees/{emp['id']}/history").json()["items"]]
    assert actions == ["employee.deactivated", "employee.updated", "employee.created"]


def test_duplicate_employee_code_and_email_are_rejected(admin):
    create_employee(admin, "SSG-2001", "Arjun Menon")
    r = admin.post("/employees", json={"employeeCode": "ssg-2001", "fullName": "Another Person", "email": "ssg-2001@safespaceglobal.ai",
                                       "department": "Security", "designation": "Guard", "employmentType": "contract",
                                       "joiningDate": "2025-01-10"})
    assert r.status_code == 409
    assert set(r.json()["error"]["fields"]) == {"employeeCode", "email"}


def test_validation_messages_are_field_specific(admin):
    r = admin.post("/employees", json={"employeeCode": "", "fullName": "A", "department": "Ops", "designation": "Lead",
                                       "employmentType": "freelance", "joiningDate": "2025-01-10", "phone": "12"})
    fields = r.json()["error"]["fields"]
    assert r.status_code == 422 and {"employeeCode", "fullName", "employmentType", "phone"} <= set(fields)


def test_list_search_filter_sort_and_paginate(admin):
    night = create_shift(admin, "Night Security", "22:00", "06:00", 15, (1, 2, 3, 4, 5, 6, 7))
    create_employee(admin, "SSG-3001", "Meera Iyer", department="Finance")
    create_employee(admin, "SSG-3002", "Kabir Shah", night["id"], department="Security")
    create_employee(admin, "SSG-3003", "Lakshmi Nair", night["id"], department="Security")
    assert admin.get("/employees", params={"search": "kabir"}).json()["total"] == 1
    assert admin.get("/employees", params={"shiftId": night["id"]}).json()["total"] == 2
    assert admin.get("/employees", params={"shiftId": "none"}).json()["total"] == 1
    assert admin.get("/employees", params={"department": "Finance"}).json()["items"][0]["fullName"] == "Meera Iyer"
    page = admin.get("/employees", params={"sort": "name", "order": "desc", "pageSize": 2, "page": 1}).json()
    assert [e["fullName"] for e in page["items"]] == ["Meera Iyer", "Lakshmi Nair"] and page["total"] == 3
    assert admin.get("/employees", params={"faceStatus": "not_registered"}).json()["total"] == 3


def test_camera_direction_is_global_configuration(admin, viewer):
    cam = create_camera(admin, "CAM-ENT-01", "Main Entrance", "entry")
    assert cam["status"] == "not_verified" and cam["configurationIssues"] == []
    body = {k: cam[k] for k in ("cameraCode", "name", "location", "cameraType")} | {"direction": "exit", "replaceSource": False}
    r = admin.patch(f"/cameras/{cam['id']}", json=body)
    assert r.status_code == 200 and r.json()["direction"] == "exit"
    # Only administrators decide which cameras record IN and OUT.
    assert viewer.patch(f"/cameras/{cam['id']}", json=body | {"direction": "entry"}).status_code == 403
    emp = create_employee(admin, "SSG-4001", "Rohit Kulkarni")
    assert admin.put(f"/employees/{emp['id']}/cameras", json={}).status_code in (404, 405)


def test_camera_status_and_source_masking(admin, viewer):
    cam = create_camera(admin, "CAM-ENT-02", "Loading Bay Entrance", "entry", source="rtsp://nvradmin:Secr3t@10.0.4.21:554/ch2")
    assert cam["status"] == "not_verified" and cam["configurationIssues"] == []
    assert admin.get(f"/cameras/{cam['id']}").json()["sourceDisplay"].startswith("rtsp://nvradmin:Secr3t@")
    shown = viewer.get(f"/cameras/{cam['id']}").json()["sourceDisplay"]
    assert "Secr3t" not in shown and shown == "rtsp://•••@10.0.4.21:554/ch2"
    r = admin.post(f"/cameras/{cam['id']}/enabled", json={"enabled": False})
    assert r.json()["status"] == "disabled"


def test_shift_assignment_and_counts(admin):
    shift = create_shift(admin, "Morning Front Desk", "07:00", "15:00", 5)
    a = create_employee(admin, "SSG-5001", "Neha Joshi")
    b = create_employee(admin, "SSG-5002", "Vikram Das")
    r = admin.put(f"/shifts/{shift['id']}/employees", json={"employeeIds": [a["id"], b["id"]]})
    assert r.json()["employeeCount"] == 2
    assert admin.get(f"/employees/{a['id']}").json()["shift"]["name"] == "Morning Front Desk"
    admin.post(f"/shifts/{shift['id']}/status", json={"status": "inactive"})
    r = admin.put(f"/shifts/{shift['id']}/employees", json={"employeeIds": [a["id"]]})
    assert r.status_code == 422
    r = admin.post("/shifts", json={"name": "morning front desk", "shiftType": "morning", "startTime": "07:00", "endTime": "15:00",
                                    "gracePeriodMinutes": 5, "workingDays": [1]})
    assert r.status_code == 409
