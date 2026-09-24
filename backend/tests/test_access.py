from conftest import PASSWORD, Api, make_user


def test_login_rejects_wrong_password_and_unknown_account(admin):
    anon = Api()
    r = anon.client.post("/api/v1/auth/login", json={"email": "operations.admin@safespaceglobal.ai", "password": "wrong-password-1"})
    assert r.status_code == 401 and r.json()["error"]["message"] == "The email or password is incorrect."
    r = anon.client.post("/api/v1/auth/login", json={"email": "nobody@safespaceglobal.ai", "password": PASSWORD})
    assert r.status_code == 401


def test_account_locks_after_repeated_failures(admin):
    anon = Api()
    for _ in range(5):
        anon.client.post("/api/v1/auth/login", json={"email": "operations.admin@safespaceglobal.ai", "password": "wrong-password-1"})
    r = anon.client.post("/api/v1/auth/login", json={"email": "operations.admin@safespaceglobal.ai", "password": PASSWORD})
    assert r.status_code == 429 and r.json()["error"]["code"] == "account_locked"


def test_unauthenticated_requests_are_refused():
    assert Api().get("/employees").status_code == 401


def test_writes_require_csrf_token(admin):
    r = admin.client.post("/api/v1/shifts", json={})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_rejected"


def test_writes_from_foreign_origin_are_refused(admin):
    r = admin.client.post("/api/v1/shifts", json={}, headers={"X-CSRF-Token": admin.csrf, "Origin": "https://attacker.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "origin_rejected"


def test_viewer_cannot_change_data_or_manage_users(viewer):
    r = viewer.post("/employees", json={})
    assert r.status_code == 403
    assert viewer.get("/users").status_code == 403
    assert viewer.get("/employees").status_code == 200


def test_session_reports_permissions_and_timezone(admin):
    body = admin.get("/auth/session").json()
    assert "users.manage" in body["permissions"] and body["siteTimezone"] == "UTC"


def test_last_administrator_cannot_be_demoted(admin):
    me = admin.get("/auth/session").json()["user"]["id"]
    r = admin.patch(f"/users/{me}", json={"role": "viewer"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "last_administrator"


def test_user_management_enforces_password_policy_and_ends_sessions(admin):
    r = admin.post("/users", json={"email": "hr.lead@safespaceglobal.ai", "fullName": "HR Lead", "role": "hr_manager", "password": "short"})
    assert r.status_code == 422 and "password" in r.json()["error"]["fields"]
    r = admin.post("/users", json={"email": "hr.lead@safespaceglobal.ai", "fullName": "HR Lead", "role": "hr_manager", "password": PASSWORD})
    assert r.status_code == 201
    hr = Api("hr.lead@safespaceglobal.ai")
    assert hr.get("/employees").status_code == 200
    admin.patch(f"/users/{r.json()['id']}", json={"isActive": False})
    assert hr.get("/employees").status_code == 401


def test_audit_never_records_passwords(admin):
    make_user("second.admin@safespaceglobal.ai", "administrator", "Second Administrator")
    from employee_api.db import new_session
    from employee_api.models import AuditEntry
    admin.post("/users", json={"email": "desk@safespaceglobal.ai", "fullName": "Reception Desk", "role": "viewer", "password": PASSWORD})
    with new_session() as db:
        for entry in db.query(AuditEntry).all():
            assert PASSWORD not in str(entry.changes)
