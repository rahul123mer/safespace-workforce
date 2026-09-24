"""Runs modules of the existing Triton recognition package
(`restaurant_vision`, in the existing `compute/` directory) as subprocesses of
its own Python environment. This process never imports the pipeline or any
GPU library -- the same boundary the existing backend's `compute_bridge.py`
keeps -- so the pipeline, its models and its thresholds stay exactly as they
are and are only ever *called*.

The CUDA/cuDNN library order the pipeline needs (see the existing
`compute/env.sh`) must be in the child's environment before it starts, so it is
passed through `EMS_COMPUTE_LIBRARY_PATH` into `LD_LIBRARY_PATH` here."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from ..config import get_settings


class PipelineUnavailable(RuntimeError):
    """The recognition pipeline is not configured, not installed, or its models could not load."""


def _require_paths() -> tuple[Path, Path]:
    s = get_settings()
    if s.compute_root is None or s.compute_python is None:
        raise PipelineUnavailable("The recognition pipeline location is not configured (EMS_COMPUTE_ROOT and EMS_COMPUTE_PYTHON).")
    if not (s.compute_root / "restaurant_vision").is_dir():
        raise PipelineUnavailable(f"The recognition package was not found under {s.compute_root}.")
    if not s.compute_python.exists():
        raise PipelineUnavailable(f"The recognition pipeline interpreter was not found at {s.compute_python}.")
    return s.compute_root, s.compute_python


def pipeline_env() -> dict[str, str]:
    s = get_settings()
    env = os.environ.copy()
    # The API's own settings (database URL and so on) are not the pipeline's business.
    for key in [k for k in env if k.startswith("EMS_")]:
        env.pop(key)
    if s.compute_library_path:
        env["LD_LIBRARY_PATH"] = s.compute_library_path
    if s.insightface_home:
        env["INSIGHTFACE_HOME"] = str(s.insightface_home)
    env.setdefault("PYTHONUNBUFFERED", "1")
    return env


def run_module(module: str, args: list[str], *, timeout: int) -> subprocess.CompletedProcess:
    """`<compute python> -m <module> <args>` with cwd at the compute root."""
    compute_root, compute_python = _require_paths()
    if get_settings().allow_cpu_inference:
        args = [*args, "--allow-cpu"]
    try:
        return subprocess.run(
            [str(compute_python), "-m", module, *args],
            cwd=str(compute_root),
            env=pipeline_env(),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except OSError as exc:
        raise PipelineUnavailable(f"The recognition pipeline could not be started: {exc}") from exc
