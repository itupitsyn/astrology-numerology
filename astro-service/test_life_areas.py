"""Tests for the per-area day score.

The number is the most easily misread thing this service produces: it looks like
a measurement. These tests pin the properties that keep it defensible — that it
is bounded, deterministic, traceable to named findings, that an untouched area
says so instead of inventing a reading, and above all that the two routes into
an area stay separate.

That last one is a real bug that shipped in the first version: the house route
carried an aspect's valence with it, so the Moon sitting in the 6th house made
"Moon square MC" count toward *health*. The printed reason for the score was
visibly nonsense, which is exactly what a traceable number must never be.

Runnable under pytest or standalone (``python test_life_areas.py``).
"""

from __future__ import annotations

import life_areas as LA
import transits as T
from models import BirthData

BIRTH = BirthData(
    name="Test", year=1990, month=5, day=15, hour=14, minute=30,
    latitude=55.7558, longitude=37.6173, timezone="Europe/Moscow",
)

NO_HOUSES = {name: None for name in T.TRANSITING}


def aspect(transit: str, natal: str, kind: str, score: float = 1.0) -> dict:
    return {"transit": transit, "natal": natal, "aspect": kind, "score": score}


# --------------------------------------------------------------------------- #
# 1. Shape and bounds
# --------------------------------------------------------------------------- #
def test_every_area_is_scored_within_range():
    for scored in LA.score_areas([], NO_HOUSES):
        assert 1 <= scored["score"] <= 10
        assert scored["label"]
        assert scored["id"] in {a.id for a in LA.AREAS}


def test_an_untouched_day_is_quiet_and_neutral():
    """No findings at all must not produce a confident-looking verdict."""
    for scored in LA.score_areas([], NO_HOUSES):
        assert scored["quiet"] is True
        assert scored["label"] == "спокойно"
        assert scored["drivers"] == []
        assert 5 <= scored["score"] <= 7


def test_extremes_stay_inside_the_scale():
    piled_on = [aspect("Jupiter", "Venus", "trine", 5.0) for _ in range(40)]
    love = next(a for a in LA.score_areas(piled_on, NO_HOUSES) if a["id"] == "love")
    assert love["score"] == 10

    crushed = [aspect("Saturn", "Venus", "square", 5.0) for _ in range(40)]
    love = next(a for a in LA.score_areas(crushed, NO_HOUSES) if a["id"] == "love")
    assert love["score"] == 1


# --------------------------------------------------------------------------- #
# 2. Direction
# --------------------------------------------------------------------------- #
def test_harmonious_aspects_lift_and_hard_ones_lower():
    def love(records):
        return next(a for a in LA.score_areas(records, NO_HOUSES) if a["id"] == "love")["score"]

    neutral = love([])
    assert love([aspect("Jupiter", "Venus", "trine", 2.0)]) > neutral
    assert love([aspect("Saturn", "Venus", "square", 2.0)]) < neutral


def test_a_conjunction_takes_its_colour_from_the_planet():
    """Conjunction is emphasis, not a verdict: Venus and Saturn cannot both
    push the same way."""
    def love(records):
        return next(a for a in LA.score_areas(records, NO_HOUSES) if a["id"] == "love")["score"]

    assert love([aspect("Venus", "Venus", "conjunction", 2.0)]) > love([])
    assert love([aspect("Saturn", "Venus", "conjunction", 2.0)]) < love([])


def test_findings_land_in_the_area_they_belong_to():
    records = [aspect("Moon", "Mercury", "trine", 2.0)]
    scores = {a["id"]: a["score"] for a in LA.score_areas(records, NO_HOUSES)}
    assert scores["mind"] > scores["family"]
    assert not next(a for a in LA.score_areas(records, NO_HOUSES) if a["id"] == "mind")["quiet"]


# --------------------------------------------------------------------------- #
# 3. The two routes stay separate — the regression this module was rewritten for
# --------------------------------------------------------------------------- #
def test_an_unrelated_aspect_cannot_move_an_area_through_occupancy():
    """A hard aspect to the MC must not touch *health* just because the
    transiting body happens to sit in the 6th house."""
    houses = {**NO_HOUSES, "Moon": 6}
    records = [aspect("Moon", "Medium_Coeli", "square", 3.0)]

    health = next(a for a in LA.score_areas(records, houses) if a["id"] == "health")
    baseline = next(a for a in LA.score_areas([], houses) if a["id"] == "health")
    assert health["score"] == baseline["score"]

    # It must still hit career, where the MC actually belongs.
    career = next(a for a in LA.score_areas(records, houses) if a["id"] == "career")
    assert career["score"] < next(a for a in LA.score_areas([], houses) if a["id"] == "career")["score"]


def test_status_and_daily_work_are_scored_apart():
    """A day can be good for grinding through tasks and bad for asking for a
    raise. Folding those into one number loses the point of the scorecard."""
    def scores(records):
        return {a["id"]: a["score"] for a in LA.score_areas(records, NO_HOUSES)}

    # A hard hit on the MC is about standing, not about the day's workload.
    status_hit = scores([aspect("Saturn", "Medium_Coeli", "square", 3.0)])
    assert status_hit["career"] < status_hit["work"]

    # Jupiter on natal Mars is about drive to get things done, not about status.
    tasks_help = scores([aspect("Jupiter", "Mars", "trine", 3.0)])
    assert tasks_help["work"] > tasks_help["career"]


def test_work_and_communication_do_not_print_the_same_number():
    """They shared Mercury once, and produced two identical rows off identical
    drivers — two lines saying one thing."""
    records = [aspect("Sun", "Mercury", "trine", 3.0)]
    scored = {a["id"]: a for a in LA.score_areas(records, NO_HOUSES)}
    assert scored["mind"]["score"] > scored["work"]["score"]
    assert scored["work"]["quiet"] is True


def test_money_is_independent_of_both():
    money_only = {a["id"]: a["score"] for a in LA.score_areas(
        [aspect("Jupiter", "Venus", "trine", 3.0)], NO_HOUSES
    )}
    neutral = {a["id"]: a["score"] for a in LA.score_areas([], NO_HOUSES)}
    assert money_only["money"] > neutral["money"]
    assert money_only["career"] == neutral["career"]
    assert money_only["work"] == neutral["work"]


def test_occupancy_alone_still_reads_as_a_quiet_day():
    """A planet parked in a house is a standing background, not news."""
    houses = {**NO_HOUSES, "Moon": 6}
    health = next(a for a in LA.score_areas([], houses) if a["id"] == "health")
    assert health["quiet"] is True


def test_occupancy_is_coloured_by_the_planet_not_by_chance():
    def career(planet):
        houses = {**NO_HOUSES, planet: 10}
        return next(a for a in LA.score_areas([], houses) if a["id"] == "career")["score"]

    assert career("Jupiter") >= career("Saturn")


# --------------------------------------------------------------------------- #
# 4. Traceability
# --------------------------------------------------------------------------- #
def test_a_moved_score_can_always_be_explained():
    records = [aspect("Saturn", "Venus", "square", 3.0)]
    love = next(a for a in LA.score_areas(records, NO_HOUSES) if a["id"] == "love")
    assert love["drivers"], "a score that moved must name what moved it"
    assert "Saturn" in love["drivers"][0]
    assert love["drivers"][0].startswith("−"), "a hard aspect must be signed as negative"


def test_drivers_are_signed_and_capped():
    records = [aspect("Jupiter", "Venus", "trine", 3.0)] * 10
    love = next(a for a in LA.score_areas(records, NO_HOUSES) if a["id"] == "love")
    assert len(love["drivers"]) <= 3
    assert all(d[0] in "+−" for d in love["drivers"])


# --------------------------------------------------------------------------- #
# 5. End to end
# --------------------------------------------------------------------------- #
def test_a_real_day_produces_a_full_scorecard():
    result = T.compute_daily(BIRTH, date="2026-08-28", timezone="Europe/Moscow")
    assert len(result.areas) == len(LA.AREAS)
    assert {a["id"] for a in result.areas} == {a.id for a in LA.AREAS}


def test_the_scorecard_is_deterministic():
    first = T.compute_daily(BIRTH, date="2026-08-28", timezone="Europe/Moscow").areas
    second = T.compute_daily(BIRTH, date="2026-08-28", timezone="Europe/Moscow").areas
    assert first == second


def test_scores_actually_differ_between_days():
    """A scorecard that never moves is decoration, not information."""
    dates = ("2026-08-28", "2026-08-29", "2026-09-05", "2026-10-14", "2026-12-21")
    per_area: dict[str, set[int]] = {}
    for date in dates:
        for scored in T.compute_daily(BIRTH, date=date, timezone="Europe/Moscow").areas:
            per_area.setdefault(scored["id"], set()).add(scored["score"])
    moving = [area for area, seen in per_area.items() if len(seen) > 1]
    assert len(moving) >= 4, f"only {moving} varied across {len(dates)} days"


def test_it_still_works_without_a_birth_time():
    """No houses means only the aspect route, but the scorecard must still be
    complete rather than half-missing."""
    result = T.compute_daily(BIRTH, date="2026-08-28", timezone="Europe/Moscow", houses_known=False)
    assert len(result.areas) == len(LA.AREAS)
    assert all(1 <= a["score"] <= 10 for a in result.areas)
    assert all("в " not in d for a in result.areas for d in a["drivers"]), (
        "house occupancy must not appear when houses are unknown"
    )


# --------------------------------------------------------------------------- #
# Standalone runner.
# --------------------------------------------------------------------------- #
def _run_all() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL  {t.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  ERROR {t.__name__}: {exc!r}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
