from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from myschedule.domain.schedules import (
    DailyPattern,
    DateOnly,
    ScheduleTime,
    TimedInterval,
    dates_between,
    local_instant,
)


@dataclass(frozen=True)
class Source:
    id: str
    time: ScheduleTime
    important: bool = False
    status: Literal["Confirmed", "Tentative"] = "Confirmed"


@dataclass(frozen=True)
class Occurrence:
    key: str
    source_id: str
    starts_at: datetime | None
    ends_at: datetime | None
    unknown_date: date | None = None
    important: bool = False


@dataclass(frozen=True)
class DayCapacity:
    date: date
    level: Literal["Free", "Light", "Medium", "Busy"]
    known_scheduled_minutes: int
    is_partial: bool
    unknown_duration_count: int
    occurrence_count: int
    important_occurrence_count: int
    has_conflicts: bool


def classify_minutes(minutes: int) -> Literal["Free", "Light", "Medium", "Busy"]:
    if minutes < 0:
        raise ValueError("Duration cannot be negative")
    if minutes == 0:
        return "Free"
    if minutes < 360:
        return "Light"
    return "Medium" if minutes <= 600 else "Busy"


def expand(
    source: Source, window_start: date, window_end: date, view_zone: str
) -> list[Occurrence]:
    """Generate only a requested window, including tails starting before its first day."""
    if window_end < window_start:
        raise ValueError("Date window is reversed")
    window_a = local_instant(window_start, time.min, view_zone)
    window_b = local_instant(window_end + timedelta(days=1), time.min, view_zone)
    value = source.time
    if isinstance(value, TimedInterval):
        if value.starts_at < window_b and value.ends_at > window_a:
            return [
                Occurrence(
                    source.id, source.id, value.starts_at, value.ends_at, important=source.important
                )
            ]
        return []

    # Source-local dates, with a one-day lookback for end_day_offset=1.
    source_zone = ZoneInfo(value.timezone)
    first = max(value.range_start, window_a.astimezone(source_zone).date() - timedelta(days=1))
    last = min(value.range_end, window_b.astimezone(source_zone).date())
    result = []
    for day in dates_between(first, last):
        if value.weekdays is not None and day.isoweekday() not in value.weekdays:
            continue
        key = f"{source.id}:{day.isoformat()}"
        if isinstance(value, DateOnly):
            # Date-only labels stay on their explicit calendar date; no false 24-hour interval.
            if window_start <= day <= window_end:
                result.append(Occurrence(key, source.id, None, None, day, source.important))
            continue
        if not isinstance(value, DailyPattern):
            raise TypeError("Unsupported schedule time mode")
        start = local_instant(day, value.start_local_time, value.timezone)
        end = local_instant(
            day + timedelta(days=value.end_day_offset), value.end_local_time, value.timezone
        )
        if end <= start:
            raise ValueError("Occurrence must have positive elapsed duration")
        if start < window_b and end > window_a:
            result.append(Occurrence(key, source.id, start, end, important=source.important))
    return result


def calculate_day(occurrences: list[Occurrence], day: date, view_zone: str) -> DayCapacity:
    day_start = local_instant(day, time.min, view_zone)
    day_end = local_instant(day + timedelta(days=1), time.min, view_zone)
    intervals: list[tuple[datetime, datetime, str]] = []
    relevant: list[Occurrence] = []
    unknown = 0
    for occurrence in occurrences:
        if occurrence.unknown_date == day:
            relevant.append(occurrence)
            unknown += 1
        elif occurrence.starts_at is not None and occurrence.ends_at is not None:
            a = max(occurrence.starts_at.astimezone(UTC), day_start)
            b = min(occurrence.ends_at.astimezone(UTC), day_end)
            if a < b:
                intervals.append((a, b, occurrence.source_id))
                relevant.append(occurrence)

    intervals.sort()
    merged: list[tuple[datetime, datetime]] = []
    conflict = False
    # Keep source IDs for true overlaps; adjacent intervals never conflict.
    active: list[tuple[datetime, str]] = []
    for a, b, source_id in intervals:
        active = [(end, sid) for end, sid in active if end > a]
        if any(sid != source_id for _, sid in active):
            conflict = True
        active.append((b, source_id))
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    minutes = int(sum((b - a).total_seconds() for a, b in merged) / 60)
    return DayCapacity(
        date=day,
        level=classify_minutes(minutes),
        known_scheduled_minutes=minutes,
        is_partial=unknown > 0,
        unknown_duration_count=unknown,
        occurrence_count=len(relevant),
        important_occurrence_count=sum(o.important for o in relevant),
        has_conflicts=conflict,
    )


def availability(
    sources: list[Source], start: date, end: date, view_zone: str
) -> list[DayCapacity]:
    if (end - start).days not in range(92):
        raise ValueError("Choose an inclusive window of 1–92 days")
    occurrences = [o for source in sources for o in expand(source, start, end, view_zone)]
    return [calculate_day(occurrences, day, view_zone) for day in dates_between(start, end)]
