"""A per-area score for the day: career, money, relationships, and so on.

**On honesty.** A number out of ten reads as a measurement, and this is not one.
What it genuinely is: a deterministic, reproducible summary of the same findings
the rest of the engine produces, rolled up per area of life. Same inputs, same
number, every time, and every point of it traceable to a named transit. That is
worth something. It is not a probability, and it does not predict outcomes.

Three consequences are baked in deliberately:

  * the scale is coarse — a one-point difference is noise, and the caller is
    given a `label` so it can lead with the word rather than the digit;
  * an area with nothing touching it is marked `quiet` instead of being handed
    an invented number;
  * the magnitude of each contribution is the finding's existing `score`, not a
    new invented weight. Whatever the ranking engine already believes about
    speed, orb, exactness and the importance of a natal point carries straight
    through, so the scorecard cannot disagree with the highlights above it.

Houses are the traditional map from a chart to areas of life, and they need a
birth time. Without one the house route is dropped and only aspects to natal
planets count — the result is still computed, and `houses_known` on the forecast
tells the caller to present it with less confidence.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

# Neutral sits slightly above the midpoint: most days most areas are simply
# uneventful, and that should read as "fine", not "half bad".
#
# The two half-spreads are therefore different, so that both ends of the scale
# stay reachable. A single spread around an off-centre neutral quietly makes the
# bottom unreachable — the scale would run 2..10 while still being labelled "out
# of 10", and bad days would be compressed against good ones.
_NEUTRAL = 5.8
_SPREAD_DOWN = _NEUTRAL - 1.0
_SPREAD_UP = 10.0 - _NEUTRAL
# Divides the summed contributions before squashing. Tuned so an ordinary day
# lands in the 4-8 band and only a genuinely loaded area reaches the extremes.
_SCALE = 2.2


@dataclass(frozen=True)
class Area:
    id: str
    title: str
    emoji: str
    # Natal points whose condition speaks for this area.
    points: tuple[str, ...]
    # Natal houses a transiting planet must occupy to count for this area.
    houses: tuple[int, ...]


# The three work-adjacent areas are deliberately distinct, because they move
# independently and a reader acts on them differently:
#
#   career — the 10th house and the MC: status, reputation, being seen;
#   work   — the 6th: the actual tasks, the routine, colleagues, working rhythm;
#   money  — the 2nd and 8th: what comes in, what goes out, what is owed.
#
# A day can easily be good for grinding through a backlog and bad for asking for
# a raise. Folding those into one number loses exactly the distinction that makes
# the score worth reading. The 6th house feeds both work and health, which is the
# traditional reading and not an accident.
AREAS: tuple[Area, ...] = (
    Area("career", "Карьера и статус", "🏢", ("Medium_Coeli", "Sun", "Saturn"), (10,)),
    # Mercury is deliberately NOT here even though it plainly touches working
    # life: it already governs `mind`, and sharing it made the two areas print
    # identical scores off identical drivers — two lines saying one thing. Work
    # is left with doing (Mars) and duty (Saturn); talking and thinking stay
    # with `mind`.
    Area("work", "Работа и дела", "🛠", ("Mars", "Saturn"), (6,)),
    Area("money", "Деньги", "💰", ("Venus", "Jupiter"), (2, 8)),
    Area("love", "Отношения", "❤️", ("Venus", "Mars"), (7, 5)),
    Area("family", "Семья и дом", "🏠", ("Moon",), (4,)),
    Area("health", "Здоровье и силы", "💪", ("Sun", "Mars", "Ascendant"), (1, 6)),
    Area("mind", "Общение и учёба", "💬", ("Mercury",), (3, 9)),
)

# Two routes reach an area, and they must not be mixed up.
#
#   1. An aspect TO a natal point that governs the area. The aspect's own
#      valence applies: a square to natal Venus is hard on relationships.
#   2. A transiting planet standing IN one of the area's houses. Here the colour
#      comes from the PLANET, not from whatever else it happens to be aspecting.
#
# Conflating the two was the first version's bug: the Moon sitting in the 6th
# house made every Moon aspect count toward health, so "Moon square MC" — which
# says nothing about health — pushed the health score around, and the printed
# reason for the number was visibly nonsense.
_POINT_WEIGHT = 1.0
# Occupancy is a standing condition rather than an event, so it nudges rather
# than decides. Slow planets parked in a house are a months-long theme; that is
# real, and it is meant to show up as a mild constant offset.
_OCCUPANCY_WEIGHT = 0.4

_EASY = ("trine", "sextile")
_HARD = ("square", "opposition")

# A conjunction is emphasis, not a verdict — its colour comes from the planet.
# Traditional benefic/malefic, softened for the moderns.
_CONJUNCTION_VALENCE = {
    "Venus": 1.0, "Jupiter": 1.0,
    "Sun": 0.3, "Mercury": 0.2, "Moon": 0.2,
    "Uranus": -0.2, "Neptune": -0.3,
    "Mars": -0.6, "Saturn": -0.7, "Pluto": -0.7,
}


def _valence(transit: str, aspect: str) -> float:
    if aspect in _EASY:
        return 1.0
    if aspect in _HARD:
        return -1.0
    return _CONJUNCTION_VALENCE.get(transit, 0.0)


def _label(score: int, quiet: bool) -> str:
    if quiet:
        return "спокойно"
    if score <= 3:
        return "трудно"
    if score <= 5:
        return "с усилием"
    if score <= 7:
        return "ровно"
    if score <= 9:
        return "хорошо"
    return "отлично"


@dataclass
class AreaScore:
    id: str
    title: str
    emoji: str
    score: int
    label: str
    # True when nothing in today's chart touches this area. The score is then
    # the neutral value, and saying so is more honest than implying a reading.
    quiet: bool
    # Titles of the findings behind the number, so it can always be explained.
    drivers: list[str]

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "emoji": self.emoji,
            "score": self.score,
            "label": self.label,
            "quiet": self.quiet,
            "drivers": self.drivers,
        }


def score_areas(
    natal_aspects: Sequence[dict],
    transit_houses: dict[str, Optional[int]],
) -> list[dict]:
    """Roll the day's transit-to-natal findings up into a score per area.

    `natal_aspects` are the records produced by the transit engine; each carries
    the transiting body, the natal point, the aspect and the finding's score.
    `transit_houses` maps a transiting body to the natal house it occupies, or
    None when the birth time is unknown.
    """
    results: list[dict] = []

    for area in AREAS:
        total = 0.0
        drivers: list[tuple[float, str]] = []

        # Route 1 — aspects to the natal points that govern this area.
        for record in natal_aspects:
            natal = record["natal"]
            if natal not in area.points:
                continue
            transit = record["transit"]
            aspect = record["aspect"]

            contribution = _valence(transit, aspect) * float(record["score"]) * _POINT_WEIGHT
            if contribution == 0.0:
                continue
            total += contribution
            sign = "+" if contribution > 0 else "−"
            drivers.append((abs(contribution), f"{sign} {transit} {aspect} {natal}"))

        # Route 2 — planets standing in this area's houses. Coloured by the
        # planet's own nature, never by an unrelated aspect it happens to make.
        for transit, house in transit_houses.items():
            if house is None or house not in area.houses:
                continue
            contribution = _CONJUNCTION_VALENCE.get(transit, 0.0) * _OCCUPANCY_WEIGHT
            if contribution == 0.0:
                continue
            total += contribution
            sign = "+" if contribution > 0 else "−"
            drivers.append((abs(contribution), f"{sign} {transit} в {house} доме"))

        # An area only counts as touched when something *aspects* it. Occupancy
        # alone is a standing background, not news, and a house that merely has
        # a planet in it should still read as a quiet day.
        quiet = not any(" в " not in name for _weight, name in drivers)
        squashed = math.tanh(total / _SCALE)
        raw = _NEUTRAL + squashed * (_SPREAD_UP if squashed >= 0 else _SPREAD_DOWN)
        score = max(1, min(10, round(raw)))

        drivers.sort(reverse=True)
        results.append(
            AreaScore(
                id=area.id,
                title=area.title,
                emoji=area.emoji,
                score=score,
                label=_label(score, quiet),
                quiet=quiet,
                drivers=[name for _weight, name in drivers[:3]],
            ).as_dict()
        )

    return results
