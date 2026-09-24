"""Centralised configuration. Every value comes from the environment (prefix
`EMS_`) or a `.env` file next to the backend; nothing secret has a default."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EMS_", env_file=BACKEND_ROOT / ".env", extra="ignore")

    # --- persistence -------------------------------------------------------
    database_url: str = Field(description="SQLAlchemy URL, e.g. postgresql+psycopg://user:pass@host:5432/db")
    storage_dir: Path = Field(default=BACKEND_ROOT / "storage", description="Face images and imported footage")

    # --- HTTP / session ----------------------------------------------------
    allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5180", "http://127.0.0.1:5180"])
    cookie_secure: bool = False
    session_ttl_hours: int = 12
    frontend_dist_dir: Path | None = None

    # --- existing Triton recognition pipeline ------------------------------
    # Root of the existing `compute/` package (contains `restaurant_vision/`).
    compute_root: Path | None = None
    # Interpreter of the existing compute environment (`.venv-compute/bin/python3`).
    compute_python: Path | None = None
    # Value placed on LD_LIBRARY_PATH for the compute subprocess (CUDA/cuDNN order).
    compute_library_path: str | None = None
    # InsightFace model root holding `models/buffalo_l/` (passed as INSIGHTFACE_HOME).
    insightface_home: Path | None = None
    allow_cpu_inference: bool = False
    face_registration_timeout_s: int = 180
    footage_analysis_timeout_s: int = 4 * 3600

    # --- upload limits -----------------------------------------------------
    max_face_image_bytes: int = 10 * 1024 * 1024
    max_footage_bytes: int = 8 * 1024 * 1024 * 1024
    ffprobe_path: str = "ffprobe"

    # --- worker ------------------------------------------------------------
    worker_poll_seconds: float = 2.0
    job_lease_seconds: int = 600

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value):
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
