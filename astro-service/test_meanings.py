"""Tests for the plain-language readings.

Two things are worth pinning here. First, coverage: every combination the engine
can emit must produce a sentence, or a reader sees a bare chart term where the
useful text should be. Second, and more important, **variety** — the bug this
module was rewritten to fix was four identical lines in a five-line forecast,
which is invisible to a coverage test and obvious to a reader.

Runnable under pytest or standalone (``python test_meanings.py``).
"""

from __future__ import annotations

import meanings
import transits as T
from models import BirthData

ALL_ASPECTS = ("conjunction", "sextile", "square", "trine", "opposition")


# --------------------------------------------------------------------------- #
# 1. Coverage
# --------------------------------------------------------------------------- #
def test_every_transit_to_natal_combination_reads():
    """No combination the engine can produce may fall through to nothing."""
    for transit in T.TRANSITING:
        for natal in T.NATAL_POINTS:
            for aspect in ALL_ASPECTS:
                text = meanings.natal_aspect_meaning(transit, natal, aspect)
                assert text, f"no reading for {transit} {aspect} {natal}"
                assert text[0].isupper(), text
                assert text.endswith("."), text


def test_every_planet_has_event_readings():
    for planet in T.TRANSITING:
        assert meanings.ingress_meaning(planet)
        assert meanings.station_meaning(planet, retrograde=True)
        assert meanings.station_meaning(planet, retrograde=False)


def test_every_lunar_phase_event_reads():
    for phase in ("Новолуние", "Первая четверть", "Полнолуние", "Последняя четверть"):
        assert meanings.moon_phase_meaning(phase)


def test_unknown_input_returns_none_rather_than_guessing():
    assert meanings.natal_aspect_meaning("Moon", "Chiron", "trine") is None
    assert meanings.natal_aspect_meaning("Moon", "Sun", "quincunx") is None
    assert meanings.ingress_meaning("Chiron") is None


# --------------------------------------------------------------------------- #
# 2. Variety — the regression this module exists to prevent
# --------------------------------------------------------------------------- #
def test_the_area_of_life_drives_the_wording():
    """Different natal points must read differently under the same transit.

    The first version keyed the wording off the transiting planet. Because the
    Moon is the fastest mover it produces most findings, so a day's forecast came
    out as four copies of the same sentence.
    """
    texts = {
        meanings.natal_aspect_meaning("Moon", natal, "square")
        for natal in T.NATAL_POINTS
    }
    assert len(texts) == len(T.NATAL_POINTS)


def test_tone_changes_the_wording():
    easy = meanings.natal_aspect_meaning("Moon", "Mercury", "trine")
    tense = meanings.natal_aspect_meaning("Moon", "Mercury", "square")
    focus = meanings.natal_aspect_meaning("Moon", "Mercury", "conjunction")
    assert easy != tense != focus and easy != focus


def test_the_moon_adds_no_colouring_clause():
    """The Moon is the ordinary texture of any day; naming it every time is the
    noise that made the first version unreadable."""
    text = meanings.natal_aspect_meaning("Moon", "Venus", "trine")
    assert text == meanings._READING["Venus"][meanings.EASY].capitalize() + "."


def test_slower_planets_do_add_a_colouring_clause():
    moon = meanings.natal_aspect_meaning("Moon", "Venus", "square")
    saturn = meanings.natal_aspect_meaning("Saturn", "Venus", "square")
    assert saturn != moon
    assert saturn.startswith(moon[:-1])  # same reading, extra clause


def test_a_real_day_reads_without_repetition():
    """End to end: the highlights of an actual day must not repeat themselves."""
    birth = BirthData(
        name="Test", year=1990, month=5, day=15, hour=14, minute=30,
        latitude=55.7558, longitude=37.6173, timezone="Europe/Moscow",
    )
    for date in ("2026-08-28", "2026-09-03", "2026-12-21"):
        result = T.compute_daily(birth, date=date, timezone="Europe/Moscow")
        readings = [h["meaning"] for h in result.highlights if h["meaning"]]
        assert readings, f"{date} produced no readings at all"
        assert len(set(readings)) == len(readings), f"repeated reading on {date}: {readings}"


# --------------------------------------------------------------------------- #
# 3. Tone of voice
# --------------------------------------------------------------------------- #
def test_readings_never_promise_events():
    """The line this module must not cross.

    A forecast may describe a tendency; it may not tell someone what will happen
    to them. Readers take a stated future literally, and that is the one way a
    service like this does real harm.
    """
    forbidden = (
        "вы поссоритесь", "вы заболеете", "вы получите", "произойдёт",
        "случится", "обязательно", "гарантирован", "точно будет",
    )
    every_reading = [
        meanings.natal_aspect_meaning(transit, natal, aspect)
        for transit in T.TRANSITING
        for natal in T.NATAL_POINTS
        for aspect in ALL_ASPECTS
    ]
    every_reading += [meanings.ingress_meaning(p) for p in T.TRANSITING]
    every_reading += [meanings.station_meaning(p, True) for p in T.TRANSITING]
    every_reading += [meanings.moon_phase_meaning(p) for p in meanings._MOON_PHASE_MEANING]
    every_reading.append(meanings.VOID_OF_COURSE_MEANING)

    for text in every_reading:
        lowered = text.lower()
        for phrase in forbidden:
            assert phrase not in lowered, f"{phrase!r} in {text!r}"


def test_readings_are_short_enough_for_a_chat_message():
    for transit in T.TRANSITING:
        for natal in T.NATAL_POINTS:
            for aspect in ALL_ASPECTS:
                text = meanings.natal_aspect_meaning(transit, natal, aspect)
                assert len(text) <= 160, f"{len(text)} chars: {text}"


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
