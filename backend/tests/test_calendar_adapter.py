from datetime import datetime
from uuid import uuid4

import httpx
import pytest

from myschedule.integrations.google_calendar import (
    CalendarError,
    GoogleCalendarGateway,
    event_id,
    reminder_body,
)


def body(note_id):
    return reminder_body(
        note_id,
        1,
        1,
        "Synthetic test target",
        datetime.fromisoformat("2026-11-17T08:00:00+07:00"),
        "Asia/Jakarta",
    )


def test_body_is_daily_private_transparent_and_has_no_attendees():
    note = uuid4()
    data = body(note)
    assert data["transparency"] == "transparent"
    assert data["recurrence"] == ["RRULE:FREQ=DAILY"]
    assert data["reminders"]["overrides"][0]["minutes"] == 0
    assert "attendees" not in data
    assert data["id"] == event_id(note, 1) != event_id(note, 2)


async def test_existing_deterministic_event_is_not_duplicated():
    note = uuid4()
    data = body(note)
    calls = []

    def handle(request):
        calls.append(request.method)
        return httpx.Response(409) if request.method == "POST" else httpx.Response(200, json=data)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert await GoogleCalendarGateway(client).create_reminder("test@calendar", data) == data
    assert calls == ["POST", "GET"]


async def test_delete_never_touches_an_unmanaged_event():
    calls = []

    def handle(request):
        calls.append(request.method)
        return httpx.Response(200, json={"extendedProperties": {"private": {}}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(CalendarError) as exc:
            await GoogleCalendarGateway(client).stop_reminder("test", "remote", uuid4())
    assert exc.value.code == "CALENDAR_EVENT_NOT_MANAGED"
    assert calls == ["GET"]


@pytest.mark.parametrize(
    ("status", "reason", "retryable"),
    [
        (403, "userRateLimitExceeded", True),
        (403, "insufficientPermissions", False),
        (401, "authError", False),
        (429, "", True),
        (503, "", True),
    ],
)
async def test_quota_is_distinguished_from_permission(status, reason, retryable):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(status, json={"error": {"errors": [{"reason": reason}]}})
    )
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(CalendarError) as exc:
            await GoogleCalendarGateway(client).create_secondary_calendar("Test", "Asia/Jakarta")
    assert exc.value.retryable is retryable


async def test_mutating_transport_timeout_does_not_claim_success_or_blind_retry():
    calls = []

    def handle(request):
        calls.append(request.method)
        raise httpx.ReadTimeout("Synthetic failure")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(CalendarError) as exc:
            await GoogleCalendarGateway(client).create_secondary_calendar("Test", "Asia/Jakarta")
    assert exc.value.outcome_unknown
    assert calls == ["POST"]
