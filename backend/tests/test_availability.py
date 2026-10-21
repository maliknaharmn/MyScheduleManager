from datetime import UTC, date, datetime, time, timedelta

import pytest
from pydantic import ValidationError

from myschedule.domain.availability import Source, availability, classify_minutes, expand
from myschedule.domain.schedules import (
    DailyPattern,
    DateOnly,
    ScheduleInput,
    TimedInterval,
    local_instant,
)

DAY = date(2026, 11, 22)
ZONE = "Asia/Jakarta"


def timed(identifier: str, start: str, end: str, *, important=False, status="Confirmed") -> Source:
    return Source(
        identifier,
        TimedInterval(
            mode="timed_interval",
            timezone=ZONE,
            starts_at=f"2026-11-22T{start}:00+07:00",
            ends_at=f"2026-11-22T{end}:00+07:00",
        ),
        important,
        status,
    )


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [
        (0, "Free"),
        (1, "Light"),
        (359, "Light"),
        (360, "Medium"),
        (480, "Medium"),
        (600, "Medium"),
        (601, "Busy"),
    ],
)
def test_capacity_boundaries(minutes, expected):
    assert classify_minutes(minutes) == expected


def test_negative_duration_is_rejected():
    with pytest.raises(ValueError):
        classify_minutes(-1)


def test_overlaps_are_union_with_conflict():
    result = availability(
        [timed("a", "08:00", "12:00"), timed("b", "10:00", "14:00")], DAY, DAY, ZONE
    )[0]
    assert result.known_scheduled_minutes == 360
    assert result.level == "Medium"
    assert result.has_conflicts
    assert result.occurrence_count == 2


def test_touching_is_not_a_conflict():
    result = availability(
        [timed("a", "08:00", "12:00"), timed("b", "12:00", "14:00")], DAY, DAY, ZONE
    )[0]
    assert result.known_scheduled_minutes == 360
    assert not result.has_conflicts


def test_tentative_and_important_do_not_change_weight():
    sources = [timed("a", "08:00", "10:00", important=True, status="Tentative")]
    result = availability(sources, DAY, DAY, ZONE)[0]
    assert result.known_scheduled_minutes == 120
    assert result.important_occurrence_count == 1
    assert result.level == "Light"


def night_pattern(**changes) -> Source:
    values = dict(
        mode="daily_pattern",
        timezone=ZONE,
        range_start=DAY,
        range_end=date(2026, 11, 28),
        weekdays=list(range(1, 8)),
        start_local_time="18:00",
        end_local_time="05:00",
        end_day_offset=1,
    )
    values.update(changes)
    return Source("night", DailyPattern(**values))


def test_overnight_occurrences_and_final_tail():
    source = night_pattern()
    end = date(2026, 11, 29)
    occurrences = expand(source, DAY, end, ZONE)
    assert len(occurrences) == 7
    assert occurrences[-1].ends_at == datetime(2026, 11, 28, 22, tzinfo=UTC)
    result = availability([source], DAY, end, ZONE)
    assert [r.known_scheduled_minutes for r in result] == [360] + [660] * 6 + [300]
    assert sum(r.known_scheduled_minutes for r in result) == 77 * 60
    assert not any(r.has_conflicts for r in result)
    tail = availability([source], end, end, ZONE)[0]
    assert tail.occurrence_count == 1
    assert tail.level == "Light"


def test_pattern_respects_selected_weekdays_and_inclusive_end():
    source = night_pattern(weekdays=[1, 3, 5])
    occurrences = expand(source, DAY, date(2026, 11, 29), ZONE)
    assert [o.key.split(":")[1] for o in occurrences] == ["2026-11-23", "2026-11-25", "2026-11-27"]


def test_cross_month_tail_is_not_missed():
    source = night_pattern(range_start=date(2026, 10, 31), range_end=date(2026, 10, 31))
    result = availability([source], date(2026, 11, 1), date(2026, 11, 1), ZONE)[0]
    assert result.known_scheduled_minutes == 300


@pytest.mark.parametrize("mode", ["all_day", "date_only"])
def test_unknown_duration_is_not_fabricated(mode):
    source = Source("unknown", DateOnly(mode=mode, timezone=ZONE, range_start=DAY, range_end=DAY))
    result = availability([source, timed("a", "08:00", "10:00")], DAY, DAY, ZONE)[0]
    assert result.known_scheduled_minutes == 120
    assert result.is_partial and result.unknown_duration_count == 1
    assert result.occurrence_count == 2


def test_empty_day_and_unknown_day_are_distinguishable():
    empty = availability([], DAY, DAY, ZONE)[0]
    unknown = Source("u", DateOnly(mode="date_only", timezone=ZONE, range_start=DAY, range_end=DAY))
    partial = availability([unknown], DAY, DAY, ZONE)[0]
    assert empty.level == partial.level == "Free"
    assert not empty.is_partial and partial.is_partial


def test_dst_elapsed_time_uses_utc_not_wall_clock():
    source = Source(
        "dst",
        TimedInterval(
            mode="timed_interval",
            timezone="America/New_York",
            starts_at="2026-11-01T00:00:00-04:00",
            ends_at="2026-11-01T04:00:00-05:00",
        ),
    )
    day = date(2026, 11, 1)
    assert availability([source], day, day, "America/New_York")[0].known_scheduled_minutes == 300


@pytest.mark.parametrize(
    ("day", "clock"),
    [
        (date(2026, 11, 1), time(1, 30)),
        (date(2026, 3, 8), time(2, 30)),
    ],
)
def test_ambiguous_and_missing_local_times_fail_closed(day, clock):
    with pytest.raises(ValueError, match="ambiguous or does not exist"):
        local_instant(day, clock, "America/New_York")


@pytest.mark.parametrize(
    "change",
    [
        {"weekdays": []},
        {"weekdays": [1, 1]},
        {"weekdays": [8]},
        {"weekdays": [True]},
        {"range_end": "2026-11-21"},
        {"end_day_offset": 0},
        {"timezone": "not-a-timezone"},
        {"start_local_time": "18:00:30"},
    ],
)
def test_invalid_patterns_are_rejected(change):
    with pytest.raises(ValidationError):
        night_pattern(**change)


def test_window_limits_and_naive_timestamps():
    with pytest.raises(ValueError):
        availability([], DAY, DAY + timedelta(days=92), ZONE)
    with pytest.raises(ValidationError):
        TimedInterval(
            mode="timed_interval",
            timezone=ZONE,
            starts_at="2026-11-22T08:00:00",
            ends_at="2026-11-22T10:00:00",
        )


def test_unknown_schema_fields_cannot_be_injected():
    with pytest.raises(ValidationError):
        ScheduleInput(
            title="Test",
            category="Other",
            status="Confirmed",
            user_id="fake",
            time={"mode": "date_only", "timezone": ZONE, "range_start": DAY, "range_end": DAY},
        )
