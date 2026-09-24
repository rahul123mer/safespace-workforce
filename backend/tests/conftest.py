"""Test harness: a real PostgreSQL database (EMS_TEST_DATABASE_URL), real HTTP
through FastAPI's TestClient, and the recognition worker run in-process against
the pipeline test double in `tests/pipeline_double/`."""
from __future__ import annotations

import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import pytest

TEST_DB = os.environ.get("EMS_TEST_DATABASE_URL")
if not TEST_DB:
    pytest.exit("Set EMS_TEST_DATABASE_URL to an empty PostgreSQL database for the test suite.", returncode=2)

_tmp = Path(tempfile.mkdtemp(prefix="ems-test-"))
_models = _tmp / "insightface" / "models" / "buffalo_l"
_models.mkdir(parents=True)
(_models / "det_10g.onnx").write_bytes(b"detector-model-bytes")
(_models / "w600k_r50.onnx").write_bytes(b"embedder-model-bytes")

os.environ.update({
    "EMS_DATABASE_URL": TEST_DB,
    "EMS_STORAGE_DIR": str(_tmp / "storage"),
    "EMS_COMPUTE_ROOT": str(Path(__file__).parent / "pipeline_double"),
    "EMS_COMPUTE_PYTHON": sys.executable,
    "EMS_INSIGHTFACE_HOME": str(_tmp / "insightface"),
    "EMS_ALLOWED_ORIGINS": "http://testserver",
})

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from employee_api import worker  # noqa: E402
from employee_api.db import Base, get_engine, new_session  # noqa: E402
from employee_api.main import create_app  # noqa: E402
from employee_api.models import User  # noqa: E402
from employee_api.security import hash_password  # noqa: E402

PASSWORD = "Workforce-Test-2026"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with get_engine().begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    monkeypatch.delenv("TEST_FACE_RESULT", raising=False)
    monkeypatch.delenv("TEST_OBSERVE_SCRIPT", raising=False)
    monkeypatch.delenv("TEST_OBSERVE_FAIL", raising=False)


def make_user(email: str, role: str, name: str) -> None:
    with new_session() as db:
        db.add(User(email=email, full_name=name, role=role, is_active=True, password_hash=hash_password(PASSWORD)))
        db.commit()


class Api:
    """TestClient wrapper that signs in and sends the CSRF header on writes."""

    def __init__(self, email: str | None = None):
        self.client = TestClient(create_app(), base_url="http://testserver")
        self.csrf = None
        if email:
            r = self.client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
            assert r.status_code == 200, r.text
            self.csrf = r.json()["csrfToken"]

    def _headers(self):
        return {"X-CSRF-Token": self.csrf, "Origin": "http://testserver"} if self.csrf else {}

    def get(self, url, **kw):
        return self.client.get(f"/api/v1{url}", **kw)

    def post(self, url, **kw):
        return self.client.post(f"/api/v1{url}", headers=self._headers(), **kw)

    def patch(self, url, **kw):
        return self.client.patch(f"/api/v1{url}", headers=self._headers(), **kw)

    def put(self, url, **kw):
        return self.client.put(f"/api/v1{url}", headers=self._headers(), **kw)

    def delete(self, url, **kw):
        return self.client.delete(f"/api/v1{url}", headers=self._headers(), **kw)


@pytest.fixture
def admin() -> Api:
    make_user("operations.admin@safespaceglobal.ai", "administrator", "Operations Administrator")
    return Api("operations.admin@safespaceglobal.ai")


@pytest.fixture
def viewer() -> Api:
    make_user("attendance.viewer@safespaceglobal.ai", "viewer", "Attendance Desk")
    return Api("attendance.viewer@safespaceglobal.ai")


def drain_jobs() -> None:
    while worker.run_once():
        pass


def png_bytes(width: int = 320, height: int = 320) -> bytes:
    raw = b"".join(b"\x00" + b"\x80\x80\x80" * width for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


MP4_BYTES = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 2048
