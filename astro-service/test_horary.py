"""Accuracy tests for the horary engine.

Runnable both under pytest and standalone (``python test_horary.py``) so the
deterministic core stays verifiable without adding a test dependency.

Three layers:
  1. Static dignity tables vs. textbook facts (Ptolemy / Lilly).
  2. Aspect geometry vs. hand-constructed positions where the answer is exact.
  3. Verdict scenarios: synthetic charts that isolate each perfection/denial
     mode, so the judgment engine's decisions are pinned to classical rules.
"""

from __future__ import annotations

import dignities as dig
import horary as _H
from horary import Body, find_aspect, analyse_moon, judge


# --------------------------------------------------------------------------- #
# 1. Essential dignities — known textbook cases.
# --------------------------------------------------------------------------- #
def _abs(sign_num: int, deg: float) -> float:
    return sign_num * 30 + deg


def test_domicile_rulers():
    assert dig.ruler_of_sign(dig.SIGN_TO_NUM["Ari"]) == "Mars"
    assert dig.ruler_of_sign(dig.SIGN_TO_NUM["Leo"]) == "Sun"
    assert dig.ruler_of_sign(dig.SIGN_TO_NUM["Sco"]) == "Mars"
    assert dig.ruler_of_sign(dig.SIGN_TO_NUM["Aqu"]) == "Saturn"
    assert dig.ruler_of_sign(dig.SIGN_TO_NUM["Pis"]) == "Jupiter"


def test_sun_exalted_in_aries_day():
    # Sun at 19 Aries by day: exaltation + fire-day triplicity + face (Sun 10-20).
    d = dig.essential_dignities("Sun", _abs(0, 19), is_day=True)
    assert d.exaltation and d.triplicity and d.face
    assert not d.domicile and not d.term
    assert d.score == dig.SCORE_EXALTATION + dig.SCORE_TRIPLICITY + dig.SCORE_FACE
    assert not d.peregrine


def test_saturn_exalted_in_libra():
    d = dig.essential_dignities("Saturn", _abs(6, 21), is_day=True)
    assert d.exaltation and d.triplicity  # air-day triplicity is Saturn
    assert d.score == dig.SCORE_EXALTATION + dig.SCORE_TRIPLICITY


def test_mars_fall_in_cancer_keeps_its_term():
    # Fall (-4) but Mars holds the Egyptian term 0-7 Cancer (+2) -> net -2, not peregrine.
    d = dig.essential_dignities("Mars", _abs(3, 5), is_day=True)
    assert d.fall and d.term and not d.peregrine
    assert d.score == dig.SCORE_FALL + dig.SCORE_TERM


def test_moon_detriment_capricorn_night_triplicity():
    # Detriment (-5) but earth-night triplicity is the Moon (+3) -> -2.
    d = dig.essential_dignities("Moon", _abs(9, 5), is_day=False)
    assert d.detriment and d.triplicity
    assert d.score == dig.SCORE_DETRIMENT + dig.SCORE_TRIPLICITY


def test_term_boundaries_aries():
    # Aries Egyptian terms: Jup 0-6, Ven 6-12, Mer 12-20, Mar 20-25, Sat 25-30.
    assert dig.term_ruler(0, 0.0) == "Jupiter"
    assert dig.term_ruler(0, 5.99) == "Jupiter"
    assert dig.term_ruler(0, 6.0) == "Venus"
    assert dig.term_ruler(0, 19.9) == "Mercury"
    assert dig.term_ruler(0, 20.0) == "Mars"
    assert dig.term_ruler(0, 29.9) == "Saturn"


def test_faces_chaldean_sequence():
    # Aries faces: Mars, Sun, Venus.
    assert dig.face_ruler(0, 3) == "Mars"
    assert dig.face_ruler(0, 15) == "Sun"
    assert dig.face_ruler(0, 25) == "Venus"
    # Cancer 0-10 = Venus (continuing the Chaldean order).
    assert dig.face_ruler(3, 2) == "Venus"


def test_mutual_reception_detected():
    # Mars in Taurus (ruled by Venus), Venus in Aries (ruled by Mars) -> mutual by domicile.
    rec = dig.receptions("Mars", _abs(1, 10), "Venus", _abs(0, 10), is_day=True)
    assert rec["mutual"]
    assert "domicile" in rec["p1_receives_p2"]
    assert "domicile" in rec["p2_receives_p1"]


# --------------------------------------------------------------------------- #
# 2. Aspect geometry — hand-built bodies.
# --------------------------------------------------------------------------- #
def test_applying_conjunction_faster_behind():
    # Fast planet at 8 Aries (speed +1) catching slow at 12 Aries (speed +0.1).
    fast = Body("Mercury", lon=_abs(0, 8), speed=1.0)
    slow = Body("Saturn", lon=_abs(0, 12), speed=0.1)
    hit = find_aspect(fast, slow)
    assert hit is not None
    assert hit.aspect == "conjunction"
    assert hit.applying
    assert hit.degrees_to_perfect is not None
    # Separation 4 deg, closing at ~0.9 deg/day -> a few days.
    assert 3.5 < hit.degrees_to_perfect < 4.5
    assert hit.perfects_before_sign_exit


def test_separating_conjunction():
    # Fast planet already past the slow one and pulling away.
    fast = Body("Mercury", lon=_abs(0, 16), speed=1.0)
    slow = Body("Saturn", lon=_abs(0, 12), speed=0.1)
    hit = find_aspect(fast, slow)
    assert hit is not None and hit.aspect == "conjunction"
    assert not hit.applying
    assert hit.days_to_perfect is None


def test_aspect_fails_when_leaving_sign_first():
    # Applying conjunction, but the fast body is at 29 Aries and exits Aries
    # long before it catches the slow body 5 deg ahead in the next sign region.
    fast = Body("Moon", lon=_abs(0, 29), speed=13.0)
    slow = Body("Saturn", lon=_abs(1, 3), speed=0.1)  # 3 Taurus
    hit = find_aspect(fast, slow)
    # Within orb of a conjunction across the sign boundary, applying, but the
    # Moon changes sign before perfection.
    if hit is not None and hit.applying:
        assert not hit.perfects_before_sign_exit


def test_out_of_orb_returns_none():
    # 75 deg apart: 15 deg from both sextile (60) and square (90); the combined
    # moiety of Saturn+Mars is only 8.5, so neither aspect is within orb.
    a = Body("Saturn", lon=_abs(0, 0), speed=0.1)
    b = Body("Mars", lon=_abs(2, 15), speed=0.5)
    assert find_aspect(a, b) is None


def test_moon_void_of_course():
    # Moon late in Sagittarius with no planet ahead to aspect before it leaves.
    moon = Body("Moon", lon=_abs(8, 29), speed=13.0)  # 29 Sagittarius
    others = {
        "Moon": moon,
        "Sun": Body("Sun", lon=_abs(2, 10), speed=1.0),      # far behind (Gemini)
        "Saturn": Body("Saturn", lon=_abs(2, 12), speed=0.1),
        "Mars": Body("Mars", lon=_abs(1, 0), speed=0.5),
        "Venus": Body("Venus", lon=_abs(2, 20), speed=1.1),
        "Mercury": Body("Mercury", lon=_abs(2, 15), speed=1.2),
        "Jupiter": Body("Jupiter", lon=_abs(4, 0), speed=0.08),
    }
    state = analyse_moon(moon, others)
    assert state.void_of_course


def test_moon_not_void_with_applying_aspect():
    moon = Body("Moon", lon=_abs(0, 10), speed=13.0)  # 10 Aries
    others = {
        "Moon": moon,
        "Sun": Body("Sun", lon=_abs(0, 14), speed=1.0),  # 14 Aries, Moon applies to conjunction
        "Saturn": Body("Saturn", lon=_abs(6, 0), speed=0.1),
        "Mars": Body("Mars", lon=_abs(8, 0), speed=0.5),
        "Venus": Body("Venus", lon=_abs(9, 0), speed=1.1),
        "Mercury": Body("Mercury", lon=_abs(10, 0), speed=1.2),
        "Jupiter": Body("Jupiter", lon=_abs(11, 0), speed=0.08),
    }
    state = analyse_moon(moon, others)
    assert not state.void_of_course
    assert state.next_aspect is not None
    assert state.next_aspect.aspect == "conjunction"


def test_via_combusta_flag():
    moon = Body("Moon", lon=_abs(6, 20), speed=13.0)  # 20 Libra -> in via combusta
    state = analyse_moon(moon, {"Moon": moon})
    assert state.via_combusta


# --------------------------------------------------------------------------- #
# 3. Verdict scenarios — synthetic charts isolating each mode.
#
# Non-involved planets are parked far from the 0..130 test zone so they never
# form incidental aspects. Refranation needs a planet's *future* speed, which
# would otherwise come from the real ephemeris; `_run` injects a deterministic
# `speed_at` (flips sign only for the named `refran` planet) so scenarios are
# self-contained.
# --------------------------------------------------------------------------- #
def _mk(**bodies) -> dict[str, Body]:
    d = {name: Body(name, lon, sp) for name, (lon, sp) in bodies.items()}
    d.setdefault("Sun", Body("Sun", 200.0, 0.9))
    d.setdefault("Moon", Body("Moon", 340.0, 13.0))
    return d


def _run(others, q, qu, refran=None, is_day=True):
    _H.speed_at = lambda planet, jd, days: (-1.0 if planet == refran else 1.0)
    ms = analyse_moon(others["Moon"], others)
    return judge(others[q], others[qu], ms, others["Moon"], others, is_day, 2461232.0)


def test_scenario_direct_perfection_favorable_yes():
    j = _run(_mk(Venus=(6.0, 1.0), Jupiter=(128.0, 0.08)), "Venus", "Jupiter")
    assert j.verdict == "yes" and j.perfection_mode == "direct"


def test_scenario_hard_aspect_one_way_reception_qualified():
    # Mars square Saturn, applying; Mars receives Saturn by term (Cancer 0-7) ->
    # not mutual, so a qualified "yes" rather than a flat yes.
    j = _run(_mk(Mars=(4.0, 0.5), Saturn=(96.0, 0.03)), "Mars", "Saturn")
    assert j.verdict == "qualified" and j.perfection_mode == "direct"


def test_scenario_translation_of_light_yes():
    # No direct V-J perfection (both near-stationary); fast Mercury separates
    # from Venus and applies to a trine with Jupiter, carrying the light.
    j = _run(_mk(Venus=(6.0, 0.05), Jupiter=(128.0, 0.05), Mercury=(7.0, 1.4)), "Venus", "Jupiter")
    assert j.verdict == "yes" and j.perfection_mode == "translation"


def test_scenario_collection_of_light_yes():
    # Venus and Mars (no aspect to each other) both apply to slower Saturn.
    j = _run(_mk(Venus=(38.0, 1.0), Mars=(8.0, 0.6), Saturn=(100.0, 0.03)), "Venus", "Mars")
    assert j.verdict == "yes" and j.perfection_mode == "collection"


def test_scenario_prohibition_no():
    # V-J trine applying, but Mars (bodily at 7) perfects with Venus first.
    j = _run(_mk(Venus=(6.0, 1.0), Jupiter=(128.0, 0.08), Mars=(7.0, 0.0)), "Venus", "Jupiter")
    assert j.verdict == "no" and j.perfection_mode == "prohibition"


def test_scenario_refranation_no():
    # V-J trine applying, but Venus turns retrograde before it perfects.
    j = _run(_mk(Venus=(6.0, 1.0), Jupiter=(128.0, 0.08)), "Venus", "Jupiter", refran="Venus")
    assert j.verdict == "no" and j.perfection_mode == "refranation"


def test_scenario_combustion_downgrades_yes_to_qualified():
    # Direct trine would be yes, but the quesited (Jupiter) is combust the Sun.
    j = _run(_mk(Venus=(6.0, 1.0), Jupiter=(128.0, 0.08), Sun=(130.0, 0.95)), "Venus", "Jupiter")
    assert j.verdict == "qualified" and j.perfection_mode == "direct"
    assert any("сожжён" in r.lower() for r in j.reasons)


def test_scenario_besiegement_downgrades_yes_to_qualified():
    # Venus besieged bodily between Saturn (behind) and Mars (ahead).
    j = _run(_mk(Venus=(6.0, 1.0), Jupiter=(128.0, 0.05), Saturn=(3.0, 0.03), Mars=(9.5, 0.0)), "Venus", "Jupiter")
    assert j.verdict == "qualified" and j.perfection_mode == "direct"
    assert any("осад" in r.lower() for r in j.reasons)


def test_scenario_besiegement_no_false_positive_on_far_planet():
    # A planet in trine to both malefics (not bodily between them) is NOT besieged.
    others = _mk(Venus=(6.0, 1.0), Jupiter=(128.0, 0.05), Saturn=(3.0, 0.03), Mars=(9.5, 0.0))
    assert not _H._besieged(others["Jupiter"], others)


def test_scenario_void_moon_no_perfection_no():
    # No significator aspect and the Moon is void of course -> "no".
    j = _run(_mk(Venus=(6.0, 0.2), Jupiter=(51.0, 0.05), Moon=(269.0, 13.0)), "Venus", "Jupiter")
    assert j.verdict == "no" and j.perfection_mode == "none"


def test_cazimi_strengthens_not_afflicts():
    # A significator in cazimi is fortified, not downgraded.
    sun = Body("Sun", 130.0, 0.95)
    jup = Body("Jupiter", 130.1, 0.08)  # within 17' of the Sun
    assert _H.sun_relation(jup, sun) == "cazimi"


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
