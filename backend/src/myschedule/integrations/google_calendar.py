"""Calendar risk-spike adapter, not a production outbox worker or delivery guarantee.

The caller supplies a server-authenticated HTTP client. No token is returned to the UI.
Calendar creation timeouts require reconciliation/manual review; do not blindly retry them.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

import httpx

from myschedule.domain.schedules import validate_timezone

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
BASE = "https://www.googleapis.com/calendar/v3"
EVENT_NAMESPACE = UUID("bb0767eb-fadf-4e3d-bdb1-4452a72d2d29")


@dataclass
class CalendarError(Exception):
    status: int
    code: str
    retryable: bool
    outcome_unknown: bool = False


def event_id(note_id: UUID, generation: int) -> str:
    if generation < 1:
        raise ValueError("Event generation must be positive")
    # Google's event IDs accept lowercase base32hex; UUID hex is a valid subset.
    return uuid5(EVENT_NAMESPACE, f"{note_id}:{generation}").hex


def reminder_body(
    note_id: UUID, generation: int, version: int, title: str, starts_at: datetime, timezone: str
) -> dict:
    validate_timezone(timezone)
    if starts_at.tzinfo is None or starts_at.utcoffset() is None:
        raise ValueError("Reminder requires an aware datetime")
    if version < 1 or not title.strip() or len(title) > 200:
        raise ValueError("Reminder version and title are invalid")
    start = starts_at.astimezone(ZoneInfo(timezone))
    # Five minutes is visual representation, not additional scheduled capacity.
    end = (starts_at.astimezone(UTC) + timedelta(minutes=5)).astimezone(ZoneInfo(timezone))
    return {
        "id": event_id(note_id, generation),
        "summary": title,
        "start": {"dateTime": start.isoformat(), "timeZone": timezone},
        "end": {"dateTime": end.isoformat(), "timeZone": timezone},
        "recurrence": ["RRULE:FREQ=DAILY"],
        "transparency": "transparent",
        "visibility": "private",
        "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 0}]},
        "extendedProperties": {
            "private": {
                "myschedule_note_id": str(note_id),
                "myschedule_generation": str(generation),
                "myschedule_version": str(version),
            }
        },
    }


class GoogleCalendarGateway:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    async def _request(self, method: str, path: str, *, allow: set[int] | None = None, **kwargs):
        try:
            response = await self.client.request(method, f"{BASE}{path}", **kwargs)
        except httpx.TransportError as exc:
            raise CalendarError(0, "CALENDAR_TRANSPORT_FAILED", True, method != "GET") from exc
        if response.status_code in (allow or set()) or response.is_success:
            return response
        reasons: set[str] = set()
        try:
            reasons = {
                e.get("reason", "") for e in response.json().get("error", {}).get("errors", [])
            }
        except (ValueError, AttributeError, TypeError):
            pass
        quota = response.status_code == 429 or bool(
            reasons
            & {
                "rateLimitExceeded",
                "userRateLimitExceeded",
                "quotaExceeded",
            }
        )
        if quota:
            raise CalendarError(response.status_code, "CALENDAR_RATE_LIMITED", True)
        if response.status_code in {401, 403}:
            raise CalendarError(response.status_code, "CALENDAR_RECONNECT_REQUIRED", False)
        raise CalendarError(
            response.status_code, "CALENDAR_REQUEST_FAILED", response.status_code >= 500
        )

    async def create_secondary_calendar(self, title: str, timezone: str) -> str:
        validate_timezone(timezone)
        response = await self._request(
            "POST", "/calendars", json={"summary": title, "timeZone": timezone}
        )
        return response.json()["id"]

    async def create_reminder(self, calendar_id: str, body: dict) -> dict:
        from urllib.parse import quote

        path = f"/calendars/{quote(calendar_id, safe='')}/events"
        response = await self._request("POST", path, json=body, allow={409})
        if response.status_code != 409:
            return response.json()
        # An insert timeout may already have created this deterministic event.
        response = await self._request("GET", f"{path}/{body['id']}")
        existing = response.json()
        expected = body["extendedProperties"]["private"]
        actual = existing.get("extendedProperties", {}).get("private", {})
        if actual != expected or existing.get("status") == "cancelled":
            raise CalendarError(409, "CALENDAR_EVENT_ID_CONFLICT", False)
        return existing

    async def stop_reminder(self, calendar_id: str, remote_id: str, note_id: UUID) -> None:
        from urllib.parse import quote

        path = f"/calendars/{quote(calendar_id, safe='')}/events/{quote(remote_id, safe='')}"
        existing = await self._request("GET", path, allow={404, 410})
        if existing.status_code in {404, 410}:
            return
        data = existing.json()
        if data.get("extendedProperties", {}).get("private", {}).get("myschedule_note_id") != str(
            note_id
        ):
            raise CalendarError(409, "CALENDAR_EVENT_NOT_MANAGED", False)
        await self._request("DELETE", path, allow={404, 410})
