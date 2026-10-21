from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def validate_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Unknown IANA timezone") from exc
    return value


def local_instant(day: date, clock: time, zone: str) -> datetime:
    """Reject non-existent/ambiguous local times instead of silently changing an occurrence."""
    naive = datetime.combine(day, clock)
    tz = ZoneInfo(zone)
    candidates = set()
    for fold in (0, 1):
        candidate = naive.replace(tzinfo=tz, fold=fold).astimezone(UTC)
        if candidate.astimezone(tz).replace(tzinfo=None) == naive:
            candidates.add(candidate)
    if len(candidates) != 1:
        raise ValueError("Local time is ambiguous or does not exist in this timezone")
    return candidates.pop()


class TimeBase(StrictModel):
    timezone: str
    _timezone = field_validator("timezone")(validate_timezone)


class TimedInterval(TimeBase):
    mode: Literal["timed_interval"]
    starts_at: datetime
    ends_at: datetime

    @field_validator("starts_at", "ends_at")
    @classmethod
    def aware_minute(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timestamp requires an explicit UTC offset")
        if value.second or value.microsecond:
            raise ValueError("Schedule times use minute precision")
        return value.astimezone(UTC)

    @field_validator("starts_at", "ends_at", mode="before")
    @classmethod
    def explicit_timestamp(cls, value):
        if not isinstance(value, (str, datetime)):
            raise ValueError("Use RFC 3339 timestamps, not epoch numbers")
        return value

    @model_validator(mode="after")
    def valid_interval(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("End must follow start")
        return self


class DateRange(TimeBase):
    range_start: date
    range_end: date
    weekdays: list[Annotated[int, Field(strict=True, ge=1, le=7)]] | None = None

    @field_validator("weekdays")
    @classmethod
    def valid_weekdays(cls, values: list[int] | None):
        if values is not None:
            if (
                not values
                or len(values) != len(set(values))
                or any(v not in range(1, 8) for v in values)
            ):
                raise ValueError("Choose unique weekdays from 1 through 7")
            return sorted(values)
        return values

    @model_validator(mode="after")
    def valid_range(self) -> Self:
        if self.range_end < self.range_start:
            raise ValueError("Date range is reversed")
        if self.weekdays and not any(
            (self.range_start + timedelta(days=n)).isoweekday() in self.weekdays
            for n in range(min(7, (self.range_end - self.range_start).days + 1))
        ):
            raise ValueError("Date range has no selected weekdays")
        return self


class DailyPattern(DateRange):
    mode: Literal["daily_pattern"]
    weekdays: list[Annotated[int, Field(strict=True, ge=1, le=7)]]
    start_local_time: time
    end_local_time: time
    end_day_offset: Literal[0, 1]

    @field_validator("start_local_time", "end_local_time")
    @classmethod
    def minute_clock(cls, value: time) -> time:
        if value.tzinfo is not None or value.second or value.microsecond:
            raise ValueError("Use local time with minute precision and no UTC offset")
        return value

    @model_validator(mode="after")
    def valid_pattern(self) -> Self:
        if self.end_day_offset == 0 and self.end_local_time <= self.start_local_time:
            raise ValueError("Confirm next-day end for an overnight schedule")
        return self


class DateOnly(DateRange):
    mode: Literal["date_only", "all_day"]


ScheduleTime = Annotated[TimedInterval | DailyPattern | DateOnly, Field(discriminator="mode")]


class ScheduleInput(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    category: Literal["Work", "Academic", "Business", "Organization", "Personal", "Social", "Other"]
    status: Literal["Confirmed", "Tentative"]
    time: ScheduleTime
    tag_ids: list[UUID] = Field(default_factory=list, max_length=100)
    reminder_offsets_minutes: list[int] = Field(default_factory=lambda: [1440, 60], max_length=20)

    @field_validator("reminder_offsets_minutes")
    @classmethod
    def valid_offsets(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values) or any(v < 0 for v in values):
            raise ValueError("Reminder offsets must be unique and non-negative")
        return sorted(values, reverse=True)

    @field_validator("tag_ids")
    @classmethod
    def unique_tags(cls, values: list[UUID]) -> list[UUID]:
        if len(values) != len(set(values)):
            raise ValueError("Tag IDs must be unique")
        return values


def dates_between(start: date, end: date) -> Iterator[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)
