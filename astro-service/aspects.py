"""Shared aspect geometry: moving bodies, orbs, and aspect detection.

Extracted from `horary.py` so the horary judge and the daily-transit engine
compute aspects with one implementation. The two differ only in their *orb
policy*, which is passed in:

  * horary uses Lilly's moieties (`lilly_orb`) — wide, planet-based orbs over
    the seven classical planets;
  * transits use tight per-aspect orbs (`transit_orb`) over all bodies,
    because a 15 degree orb would make every day look identical.

Nothing here casts a chart or knows about houses; it is pure geometry on
ecliptic longitudes and daily motion.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Optional

import swisseph as swe

import dignities as dig

# Swiss Ephemeris ids. The classical seven are what horary judges on; the
# outer planets and the lunar node only take part in transit work.
SWE_ID: dict[str, int] = {
    "Sun": swe.SUN,
    "Moon": swe.MOON,
    "Mercury": swe.MERCURY,
    "Venus": swe.VENUS,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
    "Uranus": swe.URANUS,
    "Neptune": swe.NEPTUNE,
    "Pluto": swe.PLUTO,
    "Mean_Node": swe.MEAN_NODE,
    "Chiron": swe.CHIRON,
}

CLASSICAL = ("Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn")
TRANSITING = (
    "Sun", "Moon", "Mercury", "Venus", "Mars",
    "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
)

# Ptolemaic aspects: name -> exact angle.
ASPECT_ANGLES = {
    "conjunction": 0.0,
    "sextile": 60.0,
    "square": 90.0,
    "trine": 120.0,
    "opposition": 180.0,
}
# Which aspects are inherently easy vs hard (for colouring a verdict/tone).
FAVORABLE_ASPECTS = {"sextile", "trine"}
HARD_ASPECTS = {"square", "opposition"}

# Lilly's orbs (whole degrees); an aspect is "within orb" when the two bodies
# are closer than the mean of their two orbs (sum of moieties).
LILLY_ORB = {
    "Sun": 15.0, "Moon": 12.0, "Mercury": 7.0, "Venus": 7.0,
    "Mars": 8.0, "Jupiter": 9.0, "Saturn": 9.0,
}

# Modern transit orbs, per aspect rather than per planet. Deliberately tight:
# these decide what counts as "happening today", and the transiting Moon covers
# 13 degrees a day, so 3 degrees is already only a ~5 hour window.
TRANSIT_ORB = {
    "conjunction": 3.0,
    "opposition": 3.0,
    "square": 3.0,
    "trine": 3.0,
    "sextile": 2.0,
}
# The luminaries carry a wider orb by long convention.
_LUMINARIES = ("Sun", "Moon")
_LUMINARY_BONUS = 1.0

# Numeric step (days) used to detect whether an aspect is applying.
_DT = 0.02

#: An orb policy answers "how close must these two bodies be for this aspect
#: to count", given the two body names and the aspect name.
OrbPolicy = Callable[[str, str, str], float]


def norm360(x: float) -> float:
    return x % 360.0


def wrap180(x: float) -> float:
    """Fold an angle into (-180, 180]."""
    return (x + 180.0) % 360.0 - 180.0


def separation(lon1: float, lon2: float) -> float:
    """Angular separation in [0, 180]."""
    d = abs(lon1 - lon2) % 360.0
    return d if d <= 180.0 else 360.0 - d


def aspect_offset(lon1: float, lon2: float, target: float) -> float:
    """Signed distance from an exact aspect, in (-180, 180].

    `target` is a *directed* angle: an aspect of A degrees has targets A and
    360-A (the body can be ahead of or behind the other). Unlike `separation`,
    this changes sign as the aspect perfects, which is what lets a root finder
    bracket the exact moment.
    """
    return wrap180(norm360(lon1 - lon2) - target)


def aspect_targets(angle: float) -> tuple[float, ...]:
    """Directed targets for an aspect angle: (A, 360-A), or just (A,) for the
    conjunction and opposition, which are their own mirror."""
    if angle in (0.0, 180.0):
        return (angle,)
    return (angle, 360.0 - angle)


def lilly_orb(p1: str, p2: str, aspect: str) -> float:
    """Sum of moieties — the traditional horary orb. Aspect-independent."""
    return (LILLY_ORB[p1] + LILLY_ORB[p2]) / 2.0


def transit_orb(p1: str, p2: str, aspect: str) -> float:
    """Tight modern orb, widened when a luminary is involved."""
    base = TRANSIT_ORB.get(aspect, 2.0)
    if p1 in _LUMINARIES or p2 in _LUMINARIES:
        base += _LUMINARY_BONUS
    return base


@dataclass
class Body:
    """A moving point: ecliptic longitude and daily motion.

    A natal point is modelled as a Body with `speed=0` — it never moves, never
    leaves its sign, and every aspect to it is driven by the transiting side.
    """

    name: str
    lon: float
    speed: float  # degrees/day; negative = retrograde

    @property
    def retrograde(self) -> bool:
        return self.speed < 0

    def lon_at(self, days: float) -> float:
        return norm360(self.lon + self.speed * days)

    def sign_num(self) -> int:
        return dig.sign_num_of(self.lon)

    def exits_sign_within(self, days: float) -> bool:
        """True if the body leaves its current sign within `days` (>0)."""
        if days <= 0 or self.speed == 0:
            return False
        deg = dig.degree_in_sign(self.lon)
        travel = self.speed * days
        # Direct motion crosses the 30 boundary; retrograde crosses 0.
        if self.speed >= 0:
            return deg + travel >= 30.0
        return deg + travel < 0.0


@dataclass
class AspectHit:
    """A perfecting aspect between two bodies."""

    p1: str
    p2: str
    aspect: str
    orb: float                 # current orb from exact, degrees
    applying: bool
    days_to_perfect: Optional[float]      # None if separating
    degrees_to_perfect: Optional[float]
    perfects_before_sign_exit: bool
    favorable: bool

    def as_dict(self) -> dict:
        return {
            "p1": self.p1,
            "p2": self.p2,
            "aspect": self.aspect,
            "orb": round(self.orb, 3),
            "applying": self.applying,
            "days_to_perfect": None if self.days_to_perfect is None else round(self.days_to_perfect, 3),
            "degrees_to_perfect": None if self.degrees_to_perfect is None else round(self.degrees_to_perfect, 3),
            "perfects_before_sign_exit": self.perfects_before_sign_exit,
            "favorable": self.favorable,
        }


def find_aspect(b1: Body, b2: Body, orb: OrbPolicy = lilly_orb) -> Optional[AspectHit]:
    """Return the operative aspect between two bodies, if any is within orb.

    Applying/separating is determined numerically from the two bodies' motion;
    for an applying aspect we also compute time/degrees to exact and whether it
    perfects before either body leaves its sign.
    """
    sep_now = separation(b1.lon, b2.lon)

    best: Optional[tuple[str, float]] = None  # (aspect, orb)
    for name, angle in ASPECT_ANGLES.items():
        current = abs(sep_now - angle)
        if current <= orb(b1.name, b2.name, name) and (best is None or current < best[1]):
            best = (name, current)
    if best is None:
        return None

    aspect, current_orb = best
    angle = ASPECT_ANGLES[aspect]

    # Numeric derivative of the orb to classify applying vs separating.
    sep_next = separation(b1.lon_at(_DT), b2.lon_at(_DT))
    orb_next = abs(sep_next - angle)
    applying = orb_next < current_orb

    days: Optional[float] = None
    degs: Optional[float] = None
    perfects_before_exit = False
    if applying and current_orb > 1e-9:
        rate = (current_orb - orb_next) / _DT  # degrees/day the orb closes
        if rate > 1e-9:
            days = current_orb / rate
            degs = current_orb
            perfects_before_exit = not (
                b1.exits_sign_within(days) or b2.exits_sign_within(days)
            )

    return AspectHit(
        p1=b1.name,
        p2=b2.name,
        aspect=aspect,
        orb=current_orb,
        applying=applying,
        days_to_perfect=days,
        degrees_to_perfect=degs,
        perfects_before_sign_exit=perfects_before_exit,
        favorable=aspect in FAVORABLE_ASPECTS,
    )


def body_at(name: str, julian_day: float) -> Body:
    """Position and speed of one body at a Julian day (UT)."""
    res = swe.calc_ut(julian_day, SWE_ID[name], swe.FLG_SWIEPH | swe.FLG_SPEED)
    lon, _lat, _dist, slon, *_ = res[0]
    return Body(name=name, lon=norm360(lon), speed=slon)


def bodies_from_swe(julian_day: float, names: Iterable[str] = CLASSICAL) -> dict[str, Body]:
    """Positions and speeds for a set of bodies at a Julian day (UT)."""
    return {name: body_at(name, julian_day) for name in names}


def speed_at(planet: str, julian_day: float, days: float = 0.0) -> float:
    """Longitudinal speed (deg/day) of a body at jd + days."""
    res = swe.calc_ut(julian_day + days, SWE_ID[planet], swe.FLG_SWIEPH | swe.FLG_SPEED)
    return res[0][3]
