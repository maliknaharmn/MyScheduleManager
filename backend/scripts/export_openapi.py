"""Export the implemented public schema, without runtime secrets or external connections."""

import json
from pathlib import Path

from myschedule.config import Settings
from myschedule.main import create_app

app = create_app(Settings(_env_file=None, app_env="test"))
destination = Path(__file__).resolve().parents[1] / "openapi.json"
destination.write_text(json.dumps(app.openapi(), indent=2) + "\n")
print(f"Exported public OpenAPI schema to {destination.name}")
