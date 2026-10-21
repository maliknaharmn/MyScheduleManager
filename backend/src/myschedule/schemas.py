from datetime import time
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from myschedule.domain.schedules import StrictModel, validate_timezone


class ResponseMeta(StrictModel):
    request_id: str


class EnvelopeResponse[T](StrictModel):
    data: T
    meta: ResponseMeta


class ErrorField(StrictModel):
    path: str
    code: str
    message: str


class ErrorBody(StrictModel):
    code: str
    message: str
    fields: list[ErrorField]
    details: dict[str, Any]
    request_id: str


class ErrorResponse(StrictModel):
    error: ErrorBody


class HealthData(StrictModel):
    status: Literal["ok", "ready", "not_ready"]


class Capabilities(StrictModel):
    schedules: bool
    notes: bool
    calendar_reminders: bool


class StatusData(StrictModel):
    phase: Literal["foundation"]
    database: Literal["ready", "not_ready"]
    google_login_configured: bool
    calendar_integration: Literal["not_implemented"]
    capabilities: Capabilities
    auth_handshake_storage: Literal["single_process_memory"]


class PublicUser(StrictModel):
    id: UUID
    email: str
    display_name: str | None


class PublicProfile(StrictModel):
    timezone: str
    daily_reminder_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    version: int


class CalendarStatus(StrictModel):
    connection_status: Literal["not_implemented"]


class MeData(StrictModel):
    user: PublicUser
    profile: PublicProfile
    csrf_token: str
    calendar: CalendarStatus


class ProfileUpdate(StrictModel):
    expected_version: int = Field(gt=0)
    timezone: str | None = None
    daily_reminder_time: time | None = None

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value: str | None):
        return validate_timezone(value) if value is not None else value

    @field_validator("daily_reminder_time")
    @classmethod
    def minute_clock(cls, value: time | None):
        if value is not None and (value.tzinfo is not None or value.second or value.microsecond):
            raise ValueError("Use local clock time with minute precision")
        return value

    @model_validator(mode="after")
    def explicit_updates(self) -> Self:
        fields = self.model_fields_set - {"expected_version"}
        if not fields or any(getattr(self, field) is None for field in fields):
            raise ValueError("Provide non-null changed preferences")
        return self
