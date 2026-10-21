from dataclasses import dataclass, field
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


@dataclass
class ApiError(Exception):
    status_code: int
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)


def envelope(request: Request, data: Any, **meta: Any) -> dict[str, Any]:
    return {"data": data, "meta": {"request_id": request.state.request_id, **meta}}


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
                "fields": [],
                "request_id": request.state.request_id,
            }
        },
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Do not serialize Pydantic's `input` or exception context: they can contain secrets.
    fields = [
        {
            "path": ".".join(str(p) for p in error["loc"][1:]),
            "code": error["type"],
            "message": "Nilai tidak valid. Periksa format dan batas isian.",
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Periksa isian yang belum valid.",
                "fields": fields,
                "details": {},
                "request_id": request.state.request_id,
            }
        },
    )
