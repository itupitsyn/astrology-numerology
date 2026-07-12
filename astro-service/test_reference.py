"""Reference / integration tests for the horary chart engine.

These validate the *astronomical and wiring* layer — the part that can be
checked objectively, without a master astrologer's verdict:

  * kerykeion's planet positions agree with raw Swiss Ephemeris;
  * the Regiomontanus Ascendant agrees with an independent `swe.houses_ex`;
  * the significator is the traditional ruler of the Ascendant's sign;
  * the Sun falls in the externally-known sign for a given calendar date.

They also provide a data-driven fixture table (`REFERENCE_CHARTS`). Right now
the fixtures only assert objective, deterministic facts (Ascendant sign,
significators). When real, expert-judged horary charts become available, add
them here with `expect_verdict=` set and this same test will check the verdict.

Runnable standalone (``python test_reference.py``) or under pytest.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import swisseph as swe

import dignities as dig
from horary import _SWE_ID, compute_horary


def _cast(y, mo, d, h, mi, lat, lon, tz, qhouse):
    return compute_horary(
        question_house=qhouse, latitude=lat, longitude=lon,
        year=y, month=mo, day=d, hour=h, minute=mi, timezone=tz,
    )


# --------------------------------------------------------------------------- #
# 1. Planet positions vs. raw Swiss Ephemeris (independent path).
# --------------------------------------------------------------------------- #
def test_planet_positions_match_raw_swisseph():
    comp = _cast(2024, 3, 15, 10, 30, 51.5074, -0.1278, "Europe/London", 7)
    jd = comp.subject.julian_day
    flags = swe.FLG_SWIEPH | swe.FLG_SPEED
    for name, pid in _SWE_ID.items():
        raw_lon = swe.calc_ut(jd, pid, flags)[0][0] % 360.0
        engine_lon = comp.bodies[name].lon
        diff = abs((engine_lon - raw_lon + 180.0) % 360.0 - 180.0)
        assert diff < 0.01, f"{name}: engine {engine_lon:.4f} vs swe {raw_lon:.4f}"


# --------------------------------------------------------------------------- #
# 2. Regiomontanus Ascendant vs. an independent swe.houses_ex.
# --------------------------------------------------------------------------- #
def test_regiomontanus_ascendant_matches_swe():
    lat, lon = 51.5074, -0.1278
    comp = _cast(2024, 3, 15, 10, 30, lat, lon, "Europe/London", 7)
    jd = comp.subject.julian_day
    # b'R' = Regiomontanus. ascmc[0] is the Ascendant's ecliptic longitude.
    _cusps, ascmc = swe.houses_ex(jd, lat, lon, b"R")
    swe_asc = ascmc[0] % 360.0
    engine_asc = float(comp.subject.first_house.abs_pos) % 360.0
    diff = abs((engine_asc - swe_asc + 180.0) % 360.0 - 180.0)
    assert diff < 0.05, f"Ascendant: engine {engine_asc:.4f} vs swe 'R' {swe_asc:.4f}"


# --------------------------------------------------------------------------- #
# 3. Significator = traditional ruler of the Ascendant sign.
# --------------------------------------------------------------------------- #
def test_querent_significator_is_ruler_of_ascendant():
    comp = _cast(2024, 3, 15, 10, 30, 51.5074, -0.1278, "Europe/London", 7)
    asc_sign = dig.sign_num_of(float(comp.subject.first_house.abs_pos))
    assert comp.querent_sig == dig.ruler_of_sign(asc_sign)


# --------------------------------------------------------------------------- #
# 4. Sun's sign by date — external astronomical anchor (mid-sign dates are
#    unambiguous). Validates the whole date -> ephemeris -> sign pipeline.
# --------------------------------------------------------------------------- #
def test_sun_sign_by_date_external_anchor():
    anchors = [
        (2024, 1, 15, "Cap"),
        (2024, 4, 15, "Ari"),
        (2024, 7, 15, "Can"),
        (2024, 10, 15, "Lib"),
    ]
    for y, mo, d, expected_sign in anchors:
        comp = _cast(y, mo, d, 12, 0, 0.0, 0.0, "UTC", 1)
        sun = next(b for b in comp.bodies.values() if b.name == "Sun")
        got = dig.NUM_TO_SIGN[dig.sign_num_of(sun.lon)]
        assert got == expected_sign, f"{y}-{mo:02d}-{d:02d}: Sun in {got}, expected {expected_sign}"


# --------------------------------------------------------------------------- #
# 5. Data-driven fixture table.
#
# Objective fields (asc sign, significators) are checked today. Add real
# expert-judged charts with `expect_verdict=` when available — see the trailing
# placeholder entry for the shape.
# --------------------------------------------------------------------------- #
@dataclass
class RefChart:
    name: str
    year: int
    month: int
    day: int
    hour: int
    minute: int
    lat: float
    lon: float
    tz: str
    quesited_house: int
    expect_asc_sign: Optional[str] = None          # e.g. "Sco"
    expect_querent_sig: Optional[str] = None        # e.g. "Mars"
    expect_quesited_sig: Optional[str] = None
    expect_verdict: Optional[str] = None            # fill in for real charts
    source: str = ""


# NOTE: the seed rows below pin the engine's deterministic chart-casting so a
# future refactor can't silently change it. They are NOT expert-judged — none
# sets `expect_verdict`. Drop real horary charts here (with a verdict + source)
# to turn this into true verdict calibration.
REFERENCE_CHARTS: list[RefChart] = [
    RefChart(
        name="London 2024-03-15 10:30 (7th-house question)",
        year=2024, month=3, day=15, hour=10, minute=30,
        lat=51.5074, lon=-0.1278, tz="Europe/London", quesited_house=7,
        expect_asc_sign="Can", expect_querent_sig="Moon", expect_quesited_sig="Saturn",
        source="engine regression pin (deterministic ephemeris)",
    ),
    RefChart(
        name="Moscow 2026-07-11 14:30 (10th-house question)",
        year=2026, month=7, day=11, hour=14, minute=30,
        lat=55.7558, lon=37.6173, tz="Europe/Moscow", quesited_house=10,
        expect_asc_sign="Sco", expect_querent_sig="Mars",
        source="engine regression pin (deterministic ephemeris)",
    ),
    # --- add real expert-judged charts below, e.g. ---
    # RefChart(
    #     name="Frawley: will I get the job?",
    #     year=2003, month=1, day=6, hour=15, minute=6,
    #     lat=51.45, lon=-2.58, tz="Europe/London", quesited_house=10,
    #     expect_verdict="yes",
    #     source="J. Frawley, The Horary Textbook, p.NN",
    # ),
]


def _check_fixture(ref: RefChart) -> None:
    comp = _cast(ref.year, ref.month, ref.day, ref.hour, ref.minute,
                 ref.lat, ref.lon, ref.tz, ref.quesited_house)
    if ref.expect_asc_sign is not None:
        got = dig.NUM_TO_SIGN[dig.sign_num_of(float(comp.subject.first_house.abs_pos))]
        assert got == ref.expect_asc_sign, f"{ref.name}: Asc {got}, expected {ref.expect_asc_sign}"
    if ref.expect_querent_sig is not None:
        assert comp.querent_sig == ref.expect_querent_sig, f"{ref.name}: querent sig {comp.querent_sig}"
    if ref.expect_quesited_sig is not None:
        assert comp.quesited_sig == ref.expect_quesited_sig, f"{ref.name}: quesited sig {comp.quesited_sig}"
    if ref.expect_verdict is not None:
        assert comp.judgment.verdict == ref.expect_verdict, (
            f"{ref.name}: verdict {comp.judgment.verdict}, expected {ref.expect_verdict} "
            f"(mode {comp.judgment.perfection_mode})"
        )


def test_reference_chart_fixtures():
    for ref in REFERENCE_CHARTS:
        _check_fixture(ref)


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
