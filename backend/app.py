"""Vercel's explicit Python/ASGI entrypoint; never use the container runtime here."""

import os
import sys
from pathlib import Path

# The src-layout package is installed in normal development/Cloud deployments.
# Vercel installs runtime dependencies and loads this source directly.
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from myschedule.main import app  # noqa: E402, F401

if os.environ.get("VERCEL") == "1" and app.state.settings.oauth_state_storage != "postgres":
    raise RuntimeError("Vercel requires shared PostgreSQL OAuth state; memory mode is unsafe")
