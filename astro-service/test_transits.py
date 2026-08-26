"""Accuracy tests for the daily transit engine.

Runnable both under pytest and standalone (``python test_transits.py``), matching
the other suites in this service.

Four layers:
  1. Aspect geometry helpers shared with horary (`aspects`).
  2. The event scanner: every reported moment is verified *independently* — a
     reported ingress must actually sit on a sign cusp, a reported station must
     actually have zero speed, a reported lunar phase must actually be at its
     elongation. This is what keeps the root finder honest.
  3. Day boundaries, which must follow the user's timezone rather than the
     server's.
  4. Ranking behaviour: the rules that decide what a reader is shown.
"""

from __future__ import annotations

import aspects
import dignities as dig
import transits as T
from aspects import Body, aspect_offset, aspect_targets, lilly_orb, separation, transit_orb
from models import BirthData

# A fixed natal chart and a fixed date, so every expectation below is stable.
BIRTH = BirthData(
    name="Test",
    year=1990, month=5, day=15, hour=14, minute=30,
    latitude=55.7558, longitude=37.6173, timezone="Europe/Moscow",
    city="Moscow",
)
DATE = "2026-08-25"
TZ = "Europe/Moscow"

_RESULT = None


def result():
    """Compute once — the engine is deterministic, so every test can share it."""
    global _RESULT
    if _RESULT is None:
        _RESULT = T.compute_daily(
            BIRTH, date=DATE, timezone=TZ,
            latitude=55.7558, longitude=37.6173,
        )
    return _RESULT


def _abs(sign_num: int, deg: float) -> float:
    return sign_num * 30 + deg


# --------------------------------------------------------------------------- #
# 1. Aspect geometry
# --------------------------------------------------------------------------- #
def test_aspect_offset_is_zero_at_exact():
    # Trine: 0 Aries to 0 Leo is exactly 120 degrees.
    assert abs(aspect_offset(_abs(4, 0), _abs(0, 0), 120.0)) < 1e-9


def test_aspect_offset_changes_sign_through_exact():
    # A body approaching an exact square from below crosses zero, which is what
    # makes the moment bracketable by bisection.
    before = aspect_offset(_abs(2, 29), _abs(0, 0), 90.0)   # 89 degrees apart
    after = aspect_offset(_abs(3, 1), _abs(0, 0), 90.0)     # 91 degrees apart
    assert before < 0 < after
    assert abs(before) == abs(after) == 1.0


def test_aspect_targets_mirror_only_for_asymmetric_aspects():
    # A trine can be ahead or behind; a conjunction and an opposition cannot.
    assert aspect_targets(120.0) == (120.0, 240.0)
    assert aspect_targets(0.0) == (0.0,)
    assert aspect_targets(180.0) == (180.0,)


def test_transit_orbs_are_tighter_than_horary_orbs():
    # The whole point of a separate policy: Lilly's Moon/Saturn orb is 10.5
    # degrees, which would make every day look identical.
    assert transit_orb("Moon", "Saturn", "conjunction") < lilly_orb("Moon", "Saturn", "conjunction")
    assert transit_orb("Mars", "Saturn", "sextile") == 2.0
    # Luminaries carry a wider orb.
    assert transit_orb("Moon", "Saturn", "sextile") == 3.0


def test_natal_point_is_a_motionless_body():
    natal = Body("Sun", lon=_abs(0, 10), speed=0.0)
    assert natal.lon_at(5.0) == natal.lon
    assert not natal.exits_sign_within(100.0)


def test_find_aspect_to_natal_point_is_driven_by_the_transit():
    # Transiting Mars at 8 Aries closing on a natal Sun at 10 Aries.
    transit = Body("Mars", lon=_abs(0, 8), speed=0.5)
    natal = Body("Sun", lon=_abs(0, 10), speed=0.0)
    hit = aspects.find_aspect(transit, natal, transit_orb)
    assert hit is not None
    assert hit.aspect == "conjunction"
    assert hit.applying
    assert abs(hit.days_to_perfect - 4.0) < 0.1  # 2 degrees at 0.5 deg/day


# --------------------------------------------------------------------------- #
# 2. The event scanner, verified against an independent recomputation
# --------------------------------------------------------------------------- #
def test_reported_ingress_lands_on_a_sign_cusp():
    """Every ingress time must actually put the planet on a 30-degree boundary."""
    found = [e for e in result().events if e["kind"] == "ingress"]
    assert found, "the fixture day has at least one ingress"
    for event in found:
        jd = _jd_of(event["time_local"])
        lon = aspects.body_at(event["planet"], jd).lon
        degrees_into_sign = lon % 30.0
        # Within a hundredth of a degree of a cusp (from either side).
        assert min(degrees_into_sign, 30.0 - degrees_into_sign) < 0.01, event


def test_reported_ingress_matches_the_reported_signs():
    for event in [e for e in result().events if e["kind"] == "ingress"]:
        jd = _jd_of(event["time_local"])
        before = aspects.body_at(event["planet"], jd - 0.01).lon
        after = aspects.body_at(event["planet"], jd + 0.01).lon
        assert dig.NUM_TO_SIGN[dig.sign_num_of(before)] == event["from_sign"], event
        assert dig.NUM_TO_SIGN[dig.sign_num_of(after)] == event["to_sign"], event


def test_reported_station_has_zero_speed():
    for event in [e for e in result().events if e["kind"] == "station"]:
        jd = _jd_of(event["time_local"])
        assert abs(aspects.speed_at(event["planet"], jd)) < 1e-4, event


def test_reported_moon_phase_is_at_its_exact_elongation():
    expected = {"Новолуние": 0.0, "Первая четверть": 90.0,
                "Полнолуние": 180.0, "Последняя четверть": 270.0}
    for event in [e for e in result().events if e["kind"] == "moon_phase"]:
        jd = _jd_of(event["time_local"])
        elongation = (aspects.body_at("Moon", jd).lon - aspects.body_at("Sun", jd).lon) % 360.0
        assert abs(aspects.wrap180(elongation - expected[event["phase"]])) < 0.01, event


def test_reported_exact_aspect_times_really_are_exact():
    """The headline claim of the whole engine: 'exact at HH:MM' must be true."""
    checked = 0
    for record in result().natal_aspects:
        if not record["exact_local"]:
            continue
        jd = _jd_of(record["exact_local"])
        natal_lon = _natal_frame().points[record["natal"]].lon
        transit_lon = aspects.body_at(record["transit"], jd).lon
        angle = aspects.ASPECT_ANGLES[record["aspect"]]
        assert abs(separation(transit_lon, natal_lon) - angle) < 0.01, record
        checked += 1
    assert checked, "the fixture day has at least one perfecting transit"


def test_all_event_times_fall_inside_the_requested_day():
    day = result().date
    for event in result().events:
        assert event["time_local"].startswith(day), event


# --------------------------------------------------------------------------- #
# 3. Void of course
# --------------------------------------------------------------------------- #
def test_void_of_course_ends_at_a_moon_ingress():
    """A void period runs until the Moon changes sign — so its end must be a
    cusp crossing, whether or not that ingress falls inside the day."""
    for period in result().moon["void_of_course"]:
        jd = _jd_of(period["end_local"])
        degrees_into_sign = aspects.body_at("Moon", jd).lon % 30.0
        assert min(degrees_into_sign, 30.0 - degrees_into_sign) < 0.02, period


def test_void_of_course_starts_after_the_last_classical_aspect():
    """Nothing may perfect between the start of a void period and its end —
    that is the definition of the Moon being void."""
    for period in result().moon["void_of_course"]:
        start, end = _jd_of(period["start_local"]), _jd_of(period["end_local"])
        # Sample the interior; no classical aspect may perfect in there.
        steps = 40
        for i in range(1, steps):
            jd = start + (end - start) * i / steps
            moon = aspects.body_at("Moon", jd)
            for name in aspects.CLASSICAL:
                if name == "Moon":
                    continue
                other = aspects.body_at(name, jd)
                for angle in aspects.ASPECT_ANGLES.values():
                    assert abs(separation(moon.lon, other.lon) - angle) > 0.05, (
                        f"{name} perfects inside the void period {period}"
                    )


def test_void_of_course_flags_periods_that_straddle_midnight():
    """A period beginning yesterday must be reported, and marked as such."""
    for period in result().moon["void_of_course"]:
        starts_before = not period["start_local"].startswith(result().date)
        assert period["starts_before_day"] == starts_before, period


# --------------------------------------------------------------------------- #
# 4. Day boundaries follow the user's timezone
# --------------------------------------------------------------------------- #
def test_day_boundary_is_local_not_utc():
    """The same calendar date in Vladivostok and in Lisbon is a different sky.
    A user must never be handed a day sliced at the server's midnight."""
    east = T.compute_daily(BIRTH, date=DATE, timezone="Asia/Vladivostok",
                           latitude=43.12, longitude=131.89)
    west = T.compute_daily(BIRTH, date=DATE, timezone="Europe/Lisbon",
                           latitude=38.72, longitude=-9.14)
    assert east.date == west.date == DATE
    # 10 hours apart, so the noon snapshots cannot coincide.
    assert east.moon["abs_position"] != west.moon["abs_position"]
    assert east.reference_utc != west.reference_utc


def test_reference_moment_honours_the_requested_hour():
    early = T.compute_daily(BIRTH, date=DATE, timezone=TZ, reference_hour=6)
    late = T.compute_daily(BIRTH, date=DATE, timezone=TZ, reference_hour=22)
    assert early.reference_local.endswith("T06:00")
    assert late.reference_local.endswith("T22:00")
    # The Moon covers roughly half a degree an hour.
    travelled = (late.moon["abs_position"] - early.moon["abs_position"]) % 360.0
    assert 6.0 < travelled < 10.0


def test_computation_is_deterministic():
    first = T.compute_daily(BIRTH, date=DATE, timezone=TZ)
    second = T.compute_daily(BIRTH, date=DATE, timezone=TZ)
    assert first.highlights == second.highlights
    assert first.natal_aspects == second.natal_aspects


# --------------------------------------------------------------------------- #
# 5. Natal frame
# --------------------------------------------------------------------------- #
def test_house_lookup_covers_the_whole_circle():
    frame = _natal_frame()
    seen = {frame.house_of(lon) for lon in range(0, 360)}
    assert seen == set(range(1, 13))


def test_house_of_a_cusp_is_that_house():
    frame = _natal_frame()
    for index, cusp in enumerate(frame.cusps):
        assert frame.house_of(cusp + 1e-6) == index + 1


def test_every_transiting_body_gets_a_natal_house():
    for position in result().positions:
        assert 1 <= position["natal_house"] <= 12, position


# --------------------------------------------------------------------------- #
# 5b. Unknown birth time
# --------------------------------------------------------------------------- #
def _no_time():
    """The same chart computed as if the birth time were unknown."""
    return T.compute_daily(BIRTH, date=DATE, timezone=TZ, houses_known=False)


def test_unknown_birth_time_reports_no_houses():
    """Houses sweep the whole zodiac in 24 hours. Without a birth time they are
    not approximate, they are meaningless — so they must be absent, not guessed."""
    res = _no_time()
    assert res.houses_known is False
    for position in res.positions:
        assert position["natal_house"] is None, position
    assert res.moon["natal_house"] is None


def test_unknown_birth_time_drops_the_angles():
    """The Ascendant and MC depend entirely on the time of day, so no transit
    may be reported as aspecting them."""
    res = _no_time()
    aspected = {record["natal"] for record in res.natal_aspects}
    assert "Ascendant" not in aspected
    assert "Medium_Coeli" not in aspected
    assert "Ascendant" not in T.build_natal_frame(BIRTH, houses_known=False).points


def test_unknown_birth_time_still_reports_planetary_transits():
    """Everything that does not depend on the hour must survive: planet-to-planet
    transits, the Moon's phase, ingresses, void-of-course."""
    res = _no_time()
    assert res.natal_aspects, 'planetary transits are still computed'
    assert res.positions and res.retrogrades is not None
    assert res.moon["phase_name"]
    assert res.highlights


def test_dropping_houses_changes_nothing_else():
    """Turning houses off must remove exactly the house-dependent findings and
    leave every planetary one byte-identical."""
    with_houses = result()
    without = _no_time()

    def planetary(records):
        return [r for r in records if r["natal"] not in ("Ascendant", "Medium_Coeli")]

    assert planetary(with_houses.natal_aspects) == planetary(without.natal_aspects)
    assert with_houses.sky_aspects == without.sky_aspects
    assert with_houses.events == without.events
    assert with_houses.moon["phase_angle"] == without.moon["phase_angle"]


# --------------------------------------------------------------------------- #
# 6. Ranking — the rules that decide what a reader actually sees
# --------------------------------------------------------------------------- #
def test_fast_bodies_are_today_and_slow_ones_are_background():
    assert T.layer_of("Moon") == T.LAYER_TODAY
    assert T.layer_of("Mars") == T.LAYER_TODAY
    assert T.layer_of("Pluto") == T.LAYER_BACKGROUND
    assert T.layer_of("Jupiter") == T.LAYER_BACKGROUND


def test_highlights_cap_the_slow_background_layer():
    """Without this cap a chart under a multi-year Pluto transit would show the
    same lines every morning."""
    background = [h for h in result().highlights if h["layer"] == T.LAYER_BACKGROUND]
    assert len(background) <= T._MAX_BACKGROUND_HIGHLIGHTS


def test_highlights_are_ordered_by_score():
    scores = [h["score"] for h in result().highlights]
    assert scores == sorted(scores, reverse=True)


def test_highlights_respect_the_requested_limit():
    small = T.compute_daily(BIRTH, date=DATE, timezone=TZ, max_highlights=3)
    assert len(small.highlights) == 3


def test_perfecting_aspect_outranks_a_merely_wide_one():
    """An aspect that goes exact today is the day's news even if it is wide at
    the snapshot moment; a static wide aspect is not."""
    exact = T._score_aspect("Moon", "Sun", "trine", orb=5.0, applying=False, exact_today=True)
    wide = T._score_aspect("Moon", "Sun", "trine", orb=3.0, applying=False, exact_today=False)
    assert exact > wide


def test_moon_aspects_exact_late_in_the_day_are_not_missed():
    """Regression: the Moon moves ~13 degrees a day, so an aspect perfecting in
    the evening is far outside orb at the noon snapshot. Scanning only what is
    in orb at the snapshot silently dropped those."""
    wide_at_noon = [
        record for record in result().natal_aspects
        if record["transit"] == "Moon"
        and record["exact_local"]
        and record["orb"] > transit_orb("Moon", record["natal"], record["aspect"])
    ]
    assert wide_at_noon, "expected at least one Moon aspect exact today but wide at noon"


def test_sky_aspects_are_discounted_against_personal_ones():
    """Transit-to-transit weather must not outrank a transit to the person's own
    chart on equal geometry."""
    personal = T._score_aspect("Mars", "Sun", "square", orb=1.0, applying=True, exact_today=False)
    weather = T._SKY_DISCOUNT * T._score_aspect(
        "Mars", "Sun", "square", orb=1.0, applying=True, exact_today=False
    )
    assert weather < personal


# --------------------------------------------------------------------------- #
# 7. Moon summary
# --------------------------------------------------------------------------- #
def test_moon_phase_matches_the_sun_moon_elongation():
    res = result()
    sun = [p for p in res.positions if p["planet"] == "Sun"][0]
    expected = (res.moon["abs_position"] - sun["abs_position"]) % 360.0
    assert abs(res.moon["phase_angle"] - expected) < 0.02
    assert res.moon["waxing"] == (expected < 180.0)


def test_moon_illumination_brackets_the_phase():
    res = result()
    assert 0.0 <= res.moon["illumination"] <= 1.0
    # Full at 180 degrees of elongation, dark at 0.
    if res.moon["phase_angle"] > 170.0:
        assert res.moon["illumination"] > 0.98


def test_moon_sign_endpoints_bracket_the_reported_ingress():
    res = result()
    moon_ingress = [e for e in res.events if e["kind"] == "ingress" and e["planet"] == "Moon"]
    if moon_ingress:
        assert res.moon["sign_at_day_start"] != res.moon["sign_at_day_end"]
    else:
        assert res.moon["sign_at_day_start"] == res.moon["sign_at_day_end"]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
_FRAME = None


def _natal_frame():
    global _FRAME
    if _FRAME is None:
        _FRAME = T.build_natal_frame(BIRTH)
    return _FRAME


def _jd_of(local_iso: str) -> float:
    """Parse an engine-reported local timestamp back into a Julian day."""
    import datetime as _dt

    import pytz

    naive = _dt.datetime.strptime(local_iso, "%Y-%m-%dT%H:%M")
    return T._to_jd(naive, pytz.timezone(TZ))


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
