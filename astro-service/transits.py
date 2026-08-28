"""Daily transit engine: what the sky does today, and what it does to a natal chart.

The design follows two rules that decide whether a daily forecast is worth
reading at all.

1. **A day is not a moment.** Casting one chart at noon throws away everything
   that makes a day specific: the Moon covers ~13 degrees, changes sign, goes
   void of course, aspects perfect at a particular hour. So the engine *scans*
   the 24-hour window and reports events with local times, instead of
   describing a single frozen instant.

2. **Slow transits repeat for months.** Pluto square the natal Sun is "active"
   for two years; printing it every morning trains the reader to ignore the
   whole thing. Every finding is therefore tagged with a `layer` —
   ``today`` (Moon .. Mars, genuinely today's weather) or ``background``
   (Jupiter and beyond, the season) — and ranked by a deterministic score, so
   the caller can show a handful of things that actually distinguish this day.

Prioritisation lives here rather than in a prompt on purpose: an LLM handed
eighty aspects writes mush, while an LLM handed the five that scored highest
writes something specific.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Optional, Sequence

import pytz
import swisseph as swe
from kerykeion import AstrologicalSubject

import aspects
import dignities as dig
import life_areas
import meanings
from aspects import Body, aspect_offset, aspect_targets, find_aspect, transit_orb
from geocoding import resolve_timezone
from models import BirthData

logger = logging.getLogger("astro-service.transits")

# --------------------------------------------------------------------------- #
# What we look at
# --------------------------------------------------------------------------- #
# Bodies whose transits we track.
TRANSITING = aspects.TRANSITING

# Natal points a transit may aspect. The angles are included because a transit
# to the Ascendant or MC is among the most concrete things that can happen to a
# chart; the outer natal planets are kept because transits *to* them still mark
# generational themes coming due.
NATAL_POINTS = (
    "Sun", "Moon", "Mercury", "Venus", "Mars",
    "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
    "Ascendant", "Medium_Coeli",
)

# The angles. Unlike the planets these depend entirely on the birth *time*:
# they sweep the whole zodiac every 24 hours, so an unknown birth time makes
# them meaningless rather than merely imprecise.
_ANGLES = ("Ascendant", "Medium_Coeli")

# kerykeion attribute for each natal point.
_NATAL_ATTR = {name: name.lower() for name in NATAL_POINTS}

_HOUSE_ATTRS = (
    "first_house", "second_house", "third_house", "fourth_house",
    "fifth_house", "sixth_house", "seventh_house", "eighth_house",
    "ninth_house", "tenth_house", "eleventh_house", "twelfth_house",
)

# The fast movers — these are what makes one day differ from the next.
FAST_BODIES = ("Moon", "Sun", "Mercury", "Venus", "Mars")

LAYER_TODAY = "today"
LAYER_BACKGROUND = "background"


def layer_of(planet: str) -> str:
    return LAYER_TODAY if planet in FAST_BODIES else LAYER_BACKGROUND


# --------------------------------------------------------------------------- #
# Scanning resolution
# --------------------------------------------------------------------------- #
# 20 minutes: fine enough to bracket every Moon aspect (the Moon moves ~0.18
# degrees in that time, well inside any orb), cheap enough that a full day costs
# a few thousand ephemeris calls.
_SCAN_STEP = 20.0 / 1440.0
# The scan reaches beyond the day so a void-of-course period that begins
# yesterday, or ends at tomorrow's ingress, is still bounded correctly.
_SCAN_BACK = 1.0
_SCAN_FORWARD = 1.5

_REFINE_ITERATIONS = 25


# --------------------------------------------------------------------------- #
# Russian naming
# --------------------------------------------------------------------------- #
PLANET_RU = {
    "Sun": "Солнце", "Moon": "Луна", "Mercury": "Меркурий", "Venus": "Венера",
    "Mars": "Марс", "Jupiter": "Юпитер", "Saturn": "Сатурн", "Uranus": "Уран",
    "Neptune": "Нептун", "Pluto": "Плутон",
    "Ascendant": "Асцендент", "Medium_Coeli": "MC",
}

# Dative, for "... к <точке>".
_DATIVE = {
    "Sun": "Солнцу", "Moon": "Луне", "Mercury": "Меркурию", "Venus": "Венере",
    "Mars": "Марсу", "Jupiter": "Юпитеру", "Saturn": "Сатурну", "Uranus": "Урану",
    "Neptune": "Нептуну", "Pluto": "Плутону",
    "Ascendant": "Асценденту", "Medium_Coeli": "MC",
}

# "натальному Солнцу" / "натальной Луне" — the adjective has to agree.
_NATAL_ADJ = {
    "Sun": "натальному", "Moon": "натальной", "Mercury": "натальному",
    "Venus": "натальной", "Mars": "натальному", "Jupiter": "натальному",
    "Saturn": "натальному", "Uranus": "натальному", "Neptune": "натальному",
    "Pluto": "натальному", "Ascendant": "натальному", "Medium_Coeli": "натальному",
}

_SIGN_NOM = (
    "Овен", "Телец", "Близнецы", "Рак", "Лев", "Дева",
    "Весы", "Скорпион", "Стрелец", "Козерог", "Водолей", "Рыбы",
)
# Accusative, for "переходит в ...".
_SIGN_ACC = (
    "Овна", "Тельца", "Близнецы", "Рака", "Льва", "Деву",
    "Весы", "Скорпиона", "Стрельца", "Козерога", "Водолея", "Рыбы",
)
# Prepositional, for "в ...".
_SIGN_LOC = (
    "Овне", "Тельце", "Близнецах", "Раке", "Льве", "Деве",
    "Весах", "Скорпионе", "Стрельце", "Козероге", "Водолее", "Рыбах",
)

# Prepositional, for "в соединении к ...".
_ASPECT_LOC = {
    "conjunction": "в соединении",
    "sextile": "в секстиле",
    "square": "в квадрате",
    "trine": "в тригоне",
    "opposition": "в оппозиции",
}

_MOON_PHASE_RU = (
    "Новолуние", "Растущий серп", "Первая четверть", "Растущая Луна",
    "Полнолуние", "Убывающая Луна", "Последняя четверть", "Убывающий серп",
)

# Quarters that are worth an event of their own, by exact elongation.
_PHASE_EVENTS = {0.0: "Новолуние", 90.0: "Первая четверть",
                 180.0: "Полнолуние", 270.0: "Последняя четверть"}


def _natal_dative(point: str) -> str:
    return f"{_NATAL_ADJ.get(point, 'натальному')} {_DATIVE.get(point, point)}"


# --------------------------------------------------------------------------- #
# Scoring weights
# --------------------------------------------------------------------------- #
# How much a transiting body's motion says about *today* specifically.
_TRANSIT_WEIGHT = {
    "Moon": 1.0, "Sun": 0.95, "Mars": 0.85, "Mercury": 0.8, "Venus": 0.8,
    "Saturn": 0.75, "Jupiter": 0.7, "Pluto": 0.6, "Uranus": 0.6, "Neptune": 0.55,
}
# How central the receiving natal point is to the person.
_NATAL_WEIGHT = {
    "Sun": 1.5, "Moon": 1.5, "Ascendant": 1.4, "Medium_Coeli": 1.3,
    "Mercury": 1.1, "Venus": 1.1, "Mars": 1.1,
    "Jupiter": 1.0, "Saturn": 1.0,
    "Uranus": 0.8, "Neptune": 0.8, "Pluto": 0.8,
}
_ASPECT_WEIGHT = {
    "conjunction": 1.0, "opposition": 0.95, "square": 0.95,
    "trine": 0.85, "sextile": 0.7,
}
# An aspect that perfects inside the day is the day's actual news.
_EXACT_TODAY_BONUS = 1.6
_APPLYING_BONUS = 1.1
# Transit-to-transit aspects colour the general mood but are not personal.
_SKY_DISCOUNT = 0.55

_EVENT_SCORE = {
    "moon_phase_major": 1.5,   # new / full
    "moon_phase_minor": 0.9,   # quarters
    "station": 1.4,
    "ingress_planet": 1.0,
    "ingress_moon": 0.7,
    "void_of_course": 0.8,
}


# --------------------------------------------------------------------------- #
# Time helpers
# --------------------------------------------------------------------------- #
def _jd_from_utc(moment: datetime) -> float:
    hours = moment.hour + moment.minute / 60.0 + moment.second / 3600.0
    return swe.julday(moment.year, moment.month, moment.day, hours, swe.GREG_CAL)


def _utc_from_jd(julian_day: float) -> datetime:
    year, month, day, hours = swe.revjul(julian_day, swe.GREG_CAL)
    return datetime(year, month, day, tzinfo=pytz.utc) + timedelta(hours=hours)


def _local_str(julian_day: float, tz: "pytz.BaseTzInfo") -> str:
    """Local wall-clock time, to the nearest minute.

    The half-minute offset makes this *round* rather than truncate: a Julian day
    round-trip loses enough precision that a moment requested at 22:00 comes
    back as 21:59:59.9, and truncating would report the wrong minute.
    """
    moment = _utc_from_jd(julian_day).astimezone(tz) + timedelta(seconds=30)
    return moment.strftime("%Y-%m-%dT%H:%M")


def _to_jd(local_naive: datetime, tz: "pytz.BaseTzInfo") -> float:
    """Local wall-clock time -> Julian day (UT)."""
    return _jd_from_utc(tz.localize(local_naive).astimezone(pytz.utc))


# --------------------------------------------------------------------------- #
# Natal frame
# --------------------------------------------------------------------------- #
@dataclass
class NatalFrame:
    """The fixed half of the picture: natal positions and house cusps.

    Every natal point is a `Body` with ``speed=0`` — it never moves, so all the
    aspect machinery in `aspects` applies unchanged and the transiting side
    drives every application.

    `houses_known` is False when the birth time was not known. Houses and the
    angles rotate a full circle every 24 hours, so without a birth time they are
    not approximate — they are meaningless. In that case the angles are left out
    of `points` entirely and `house_of` returns None, rather than handing the
    caller a confident-looking number computed from a guess.
    """

    subject: AstrologicalSubject
    points: dict[str, Body]
    cusps: list[float]
    houses_known: bool = True

    def house_of(self, longitude: float) -> Optional[int]:
        """Which natal house an absolute longitude falls in (1..12), or None
        when the birth time was unknown."""
        if not self.houses_known:
            return None
        for index in range(12):
            start = self.cusps[index]
            span = (self.cusps[(index + 1) % 12] - start) % 360.0
            if span <= 0:
                continue
            if (longitude - start) % 360.0 < span:
                return index + 1
        return 12


def build_natal_frame(birth: BirthData, houses_known: bool = True) -> NatalFrame:
    tz_str = birth.timezone or resolve_timezone(birth.latitude, birth.longitude)
    subject = AstrologicalSubject(
        name=birth.name,
        year=birth.year, month=birth.month, day=birth.day,
        hour=birth.hour, minute=birth.minute,
        lng=birth.longitude, lat=birth.latitude, tz_str=tz_str,
        city=birth.city or "N/A",
        zodiac_type="Tropic",
        houses_system_identifier="P",  # Placidus, matching the natal endpoint.
        online=False,
    )

    wanted = NATAL_POINTS if houses_known else tuple(
        name for name in NATAL_POINTS if name not in _ANGLES
    )

    points: dict[str, Body] = {}
    for name in wanted:
        point = getattr(subject, _NATAL_ATTR[name], None)
        if point is None:
            continue
        points[name] = Body(name=name, lon=float(getattr(point, "abs_pos")), speed=0.0)

    cusps = [float(getattr(getattr(subject, attr), "abs_pos")) for attr in _HOUSE_ATTRS]
    return NatalFrame(subject=subject, points=points, cusps=cusps, houses_known=houses_known)


# --------------------------------------------------------------------------- #
# Root finding over the scanned window
# --------------------------------------------------------------------------- #
def _refine(fn: Callable[[float], float], lo: float, hi: float) -> float:
    """Bisect a bracketed sign change down to sub-second precision."""
    f_lo = fn(lo)
    for _ in range(_REFINE_ITERATIONS):
        mid = (lo + hi) / 2.0
        f_mid = fn(mid)
        if (f_mid < 0) == (f_lo < 0):
            lo, f_lo = mid, f_mid
        else:
            hi = mid
    return (lo + hi) / 2.0


@dataclass
class _Sky:
    """Sampled longitudes and speeds over the scan window."""

    times: list[float]
    lon: dict[str, list[float]]
    speed: dict[str, list[float]]

    def lon_fn(self, name: str) -> Callable[[float], float]:
        return lambda jd: aspects.body_at(name, jd).lon


def _sample_sky(jd_from: float, jd_to: float, names: Sequence[str]) -> _Sky:
    times: list[float] = []
    moment = jd_from
    while moment <= jd_to + _SCAN_STEP / 2.0:
        times.append(moment)
        moment += _SCAN_STEP

    lon = {name: [] for name in names}
    speed = {name: [] for name in names}
    for moment in times:
        for name in names:
            body = aspects.body_at(name, moment)
            lon[name].append(body.lon)
            speed[name].append(body.speed)
    return _Sky(times=times, lon=lon, speed=speed)


def _crossings(
    times: Sequence[float],
    series_a: Sequence[float],
    series_b: Sequence[float],
    target: float,
    lon_a: Callable[[float], float],
    lon_b: Callable[[float], float],
) -> list[float]:
    """Every moment in the window at which an aspect perfects exactly.

    `aspect_offset` is signed and flips as the aspect completes, which is what
    makes the crossing bracketable. Samples further than 90 degrees from exact
    are skipped: that is the wrap-around of the angle, not a perfection.
    """
    found: list[float] = []
    for i in range(len(times) - 1):
        before = aspect_offset(series_a[i], series_b[i], target)
        after = aspect_offset(series_a[i + 1], series_b[i + 1], target)
        if abs(before) > 90.0 or abs(after) > 90.0:
            continue
        if before == 0.0:
            found.append(times[i])
            continue
        if (before < 0) != (after < 0):
            found.append(
                _refine(
                    lambda jd: aspect_offset(lon_a(jd), lon_b(jd), target),
                    times[i],
                    times[i + 1],
                )
            )
    return found


# Bodies fast enough that an aspect can go from far out of orb to exact within
# the same day. Only the Moon qualifies: it covers ~13 degrees a day, so an
# aspect perfecting at 22:00 is still ~5 degrees wide at noon and would be
# missed entirely by a snapshot. Everything else moves at most ~1 degree a day,
# so if it is not within orb at the snapshot it cannot perfect before midnight.
_WIDE_SCAN_BODIES = ("Moon",)


def _exact_aspects_today(
    sky: _Sky,
    transit: str,
    other_series: Sequence[float],
    other_fn: Callable[[float], float],
    day_start: float,
    day_end: float,
    only: Optional[Sequence[str]] = None,
) -> dict[str, float]:
    """Aspect name -> local moment it perfects, for perfections inside the day."""
    out: dict[str, float] = {}
    transit_fn = sky.lon_fn(transit)
    wanted = aspects.ASPECT_ANGLES if only is None else {
        name: aspects.ASPECT_ANGLES[name] for name in only
    }
    for aspect_name, angle in wanted.items():
        for target in aspect_targets(angle):
            for moment in _crossings(
                sky.times, sky.lon[transit], other_series, target, transit_fn, other_fn
            ):
                if day_start <= moment < day_end:
                    previous = out.get(aspect_name)
                    out[aspect_name] = moment if previous is None else min(previous, moment)
    return out


# --------------------------------------------------------------------------- #
# Findings
# --------------------------------------------------------------------------- #
@dataclass
class Finding:
    """One ranked thing worth saying about the day."""

    kind: str              # "natal_aspect" | "sky_aspect" | "event"
    layer: str             # "today" | "background"
    score: float
    title: str             # the chart-level fact, e.g. "Луна в квадрате к ..."
    detail: str
    # What it means for an ordinary day. This is what a reader actually wants;
    # `title` is the receipt that backs it up. None when the combination has no
    # sensible everyday reading (transit-to-transit weather, say).
    meaning: Optional[str] = None
    time_local: Optional[str] = None
    data: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "layer": self.layer,
            "score": round(self.score, 3),
            "title": self.title,
            "detail": self.detail,
            "meaning": self.meaning,
            "time_local": self.time_local,
            "data": self.data,
        }


def _tightness(orb: float, max_orb: float) -> float:
    if max_orb <= 0:
        return 0.0
    return max(0.0, 1.0 - abs(orb) / max_orb)


def _score_aspect(
    transit: str, natal: str, aspect: str, orb: float, applying: bool, exact_today: bool
) -> float:
    # An aspect that perfects inside the day *is* exact today, so it scores at
    # full closeness regardless of how wide it happens to be at the snapshot
    # moment. Without this the Moon — whose aspects are exact for minutes, not
    # hours — would be scored as if it were barely in orb.
    max_orb = transit_orb(transit, natal, aspect)
    closeness = 1.0 if exact_today else _tightness(orb, max_orb)
    score = (
        _TRANSIT_WEIGHT.get(transit, 0.6)
        * _NATAL_WEIGHT.get(natal, 1.0)
        * _ASPECT_WEIGHT.get(aspect, 0.8)
        * closeness
    )
    if exact_today:
        score *= _EXACT_TODAY_BONUS
    if applying:
        score *= _APPLYING_BONUS
    return score


def _aspect_detail(orb: float, applying: bool, exact_local: Optional[str]) -> str:
    """Human-readable gloss. When the aspect perfects today the *time* is the
    news, so it leads; otherwise the orb does."""
    motion = "сходится" if applying else "расходится"
    if exact_local is not None:
        return f"точный аспект в {exact_local[11:]}, сейчас {motion} (орб {orb:.1f}°)"
    return f"орб {orb:.1f}°, {motion}"


def _measure(b1: Body, b2: Body, aspect: str) -> tuple[float, bool]:
    """Orb and applying/separating for a *named* aspect, ignoring whether it is
    within orb — needed for aspects that perfect later today but are still wide
    at the snapshot moment."""
    angle = aspects.ASPECT_ANGLES[aspect]
    orb = abs(aspects.separation(b1.lon, b2.lon) - angle)
    later = abs(aspects.separation(b1.lon_at(0.02), b2.lon_at(0.02)) - angle)
    return orb, later < orb


# --------------------------------------------------------------------------- #
# The engine
# --------------------------------------------------------------------------- #
@dataclass
class DailyComputation:
    date: str
    timezone: str
    latitude: float
    longitude: float
    reference_local: str
    reference_utc: str
    houses_known: bool
    moon: dict
    positions: list[dict]
    retrogrades: list[str]
    areas: list[dict]
    natal_aspects: list[dict]
    sky_aspects: list[dict]
    events: list[dict]
    highlights: list[dict]


def _moon_phase(moon_lon: float, sun_lon: float) -> dict:
    elongation = (moon_lon - sun_lon) % 360.0
    index = int(((elongation + 22.5) % 360.0) // 45.0)
    # Illuminated fraction of the disc, from the phase angle.
    illumination = (1.0 - math.cos(math.radians(elongation))) / 2.0
    return {
        "phase_angle": round(elongation, 2),
        "phase_name": _MOON_PHASE_RU[index],
        "illumination": round(illumination, 4),
        "waxing": elongation < 180.0,
    }


def _sign_info(longitude: float) -> dict:
    sign_num = dig.sign_num_of(longitude)
    return {
        "sign": dig.NUM_TO_SIGN[sign_num],
        "sign_num": sign_num,
        "sign_ru": _SIGN_NOM[sign_num],
        "position": round(dig.degree_in_sign(longitude), 4),
        "abs_position": round(longitude, 4),
    }


def _scan_ingresses(sky: _Sky) -> list[tuple[float, str, int, int]]:
    """(jd, planet, from_sign, to_sign) for every sign change in the window."""
    out: list[tuple[float, str, int, int]] = []
    for name in sky.lon:
        series = sky.lon[name]
        for i in range(len(series) - 1):
            before = dig.sign_num_of(series[i])
            after = dig.sign_num_of(series[i + 1])
            if before == after:
                continue
            # Direct motion crosses the cusp of the new sign; retrograde motion
            # crosses the cusp of the one being left.
            direct = after == (before + 1) % 12
            boundary = 30.0 * (after if direct else before)
            lon_fn = sky.lon_fn(name)
            moment = _refine(
                lambda jd: aspects.wrap180(lon_fn(jd) - boundary),
                sky.times[i],
                sky.times[i + 1],
            )
            out.append((moment, name, before, after))
    return out


def _scan_stations(sky: _Sky) -> list[tuple[float, str, bool]]:
    """(jd, planet, turns_retrograde) for every direction change."""
    out: list[tuple[float, str, bool]] = []
    for name, series in sky.speed.items():
        if name in ("Sun", "Moon"):
            continue  # never station
        for i in range(len(series) - 1):
            if (series[i] < 0) == (series[i + 1] < 0):
                continue
            speed_fn = lambda jd: aspects.speed_at(name, jd)  # noqa: B023
            moment = _refine(speed_fn, sky.times[i], sky.times[i + 1])
            out.append((moment, name, series[i + 1] < 0))
    return out


def _scan_moon_phases(sky: _Sky) -> list[tuple[float, str]]:
    out: list[tuple[float, str]] = []
    moon_fn = sky.lon_fn("Moon")
    sun_fn = sky.lon_fn("Sun")
    for target, label in _PHASE_EVENTS.items():
        for moment in _crossings(
            sky.times, sky.lon["Moon"], sky.lon["Sun"], target, moon_fn, sun_fn
        ):
            out.append((moment, label))
    return out


def _moon_exact_aspect_times(sky: _Sky) -> list[float]:
    """Moments the Moon perfects a Ptolemaic aspect to a classical planet.

    Void of course is defined against the classical seven, so the outer planets
    deliberately do not count here.
    """
    times: list[float] = []
    moon_fn = sky.lon_fn("Moon")
    for name in aspects.CLASSICAL:
        if name == "Moon":
            continue
        other_fn = sky.lon_fn(name)
        for angle in aspects.ASPECT_ANGLES.values():
            for target in aspect_targets(angle):
                times.extend(
                    _crossings(
                        sky.times, sky.lon["Moon"], sky.lon[name], target, moon_fn, other_fn
                    )
                )
    return sorted(times)


def _void_of_course_periods(
    sky: _Sky, ingresses: Sequence[tuple[float, str, int, int]]
) -> list[tuple[float, float]]:
    """Void-of-course windows in the scanned range.

    The Moon is void from the moment it perfects its last aspect to a classical
    planet until it enters the next sign — so each window is bounded by a Moon
    ingress on the right, and by the last exact aspect before it on the left.
    """
    moon_ingresses = sorted(jd for jd, name, _a, _b in ingresses if name == "Moon")
    if not moon_ingresses:
        return []
    exact_times = _moon_exact_aspect_times(sky)

    periods: list[tuple[float, float]] = []
    for end in moon_ingresses:
        # The sign the Moon is leaving started at the previous ingress (or at
        # the beginning of the scan, whichever is later).
        earlier = [jd for jd in moon_ingresses if jd < end]
        window_start = max(earlier) if earlier else sky.times[0]
        candidates = [jd for jd in exact_times if window_start <= jd < end]
        start = max(candidates) if candidates else window_start
        if end > start:
            periods.append((start, end))
    return periods


def compute_daily(
    birth: BirthData,
    *,
    date: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    timezone: Optional[str] = None,
    reference_hour: int = 12,
    reference_minute: int = 0,
    max_highlights: int = 5,
    houses_known: bool = True,
) -> DailyComputation:
    """Compute the full daily picture for one natal chart.

    `latitude`/`longitude`/`timezone` describe where the person *is now*, which
    is what defines the day's boundaries and the local time of every event. They
    default to the birth place.

    Set `houses_known=False` when the birth time is not known: houses and the
    angles are then omitted rather than computed from a placeholder time.
    """
    lat = birth.latitude if latitude is None else latitude
    lon = birth.longitude if longitude is None else longitude
    tz_str = timezone or resolve_timezone(lat, lon)
    tz = pytz.timezone(tz_str)

    # --- the day, in the user's own timezone ---
    if date:
        target = datetime.strptime(date, "%Y-%m-%d")
    else:
        now = datetime.now(tz)
        target = datetime(now.year, now.month, now.day)

    day_start = _to_jd(target, tz)
    day_end = _to_jd(target + timedelta(days=1), tz)
    reference = _to_jd(
        target + timedelta(hours=reference_hour, minutes=reference_minute), tz
    )

    natal = build_natal_frame(birth, houses_known=houses_known)

    # The scan reaches past both ends so periods that straddle midnight (and the
    # ingress that closes a void-of-course) are still bounded correctly.
    sky = _sample_sky(day_start - _SCAN_BACK, day_end + _SCAN_FORWARD, TRANSITING)

    transiting_now = {name: aspects.body_at(name, reference) for name in TRANSITING}

    findings: list[Finding] = []

    # --- transit -> natal ------------------------------------------------- #
    natal_aspects: list[dict] = []
    for t_name, t_body in transiting_now.items():
        wide = t_name in _WIDE_SCAN_BODIES
        for n_name, n_body in natal.points.items():
            fixed_series = [n_body.lon] * len(sky.times)
            fixed_fn: Callable[[float], float] = lambda _jd, value=n_body.lon: value

            hit = find_aspect(t_body, n_body, transit_orb)
            if wide:
                exact_map = _exact_aspects_today(
                    sky, t_name, fixed_series, fixed_fn, day_start, day_end
                )
            elif hit is not None:
                exact_map = _exact_aspects_today(
                    sky, t_name, fixed_series, fixed_fn, day_start, day_end, only=(hit.aspect,)
                )
            else:
                exact_map = {}

            # In orb at the snapshot, or perfecting later today — either counts.
            candidates = set(exact_map)
            if hit is not None:
                candidates.add(hit.aspect)

            for aspect_name in candidates:
                orb, applying = _measure(t_body, n_body, aspect_name)
                exact_jd = exact_map.get(aspect_name)
                exact_local = _local_str(exact_jd, tz) if exact_jd is not None else None
                score = _score_aspect(
                    t_name, n_name, aspect_name, orb, applying, exact_jd is not None
                )
                record = {
                    "transit": t_name,
                    "natal": n_name,
                    "aspect": aspect_name,
                    "orb": round(orb, 3),
                    "applying": applying,
                    "favorable": aspect_name in aspects.FAVORABLE_ASPECTS,
                    "retrograde": t_body.retrograde,
                    "layer": layer_of(t_name),
                    "exact_local": exact_local,
                    "score": round(score, 3),
                }
                natal_aspects.append(record)

                detail = _aspect_detail(orb, applying, exact_local)
                if t_body.retrograde:
                    detail += ", планета ретроградна"
                findings.append(
                    Finding(
                        kind="natal_aspect",
                        layer=layer_of(t_name),
                        score=score,
                        title=(
                            f"{PLANET_RU[t_name]} {_ASPECT_LOC[aspect_name]} "
                            f"к {_natal_dative(n_name)}"
                        ),
                        detail=detail,
                        meaning=meanings.natal_aspect_meaning(t_name, n_name, aspect_name),
                        time_local=exact_local,
                        data=record,
                    )
                )

    # --- transit -> transit (the general weather) -------------------------- #
    sky_aspects: list[dict] = []
    names = list(TRANSITING)
    for i, a_name in enumerate(names):
        for b_name in names[i + 1:]:
            # A Sun-Moon aspect *is* a lunar phase, and the phase event says it
            # far better ("Полнолуние" beats "Солнце в оппозиции к Луне"). Keeping
            # both puts the same moment in the list twice.
            if {a_name, b_name} == {"Sun", "Moon"}:
                continue

            a_body, b_body = transiting_now[a_name], transiting_now[b_name]
            wide = a_name in _WIDE_SCAN_BODIES or b_name in _WIDE_SCAN_BODIES

            hit = find_aspect(a_body, b_body, transit_orb)
            if wide:
                exact_map = _exact_aspects_today(
                    sky, a_name, sky.lon[b_name], sky.lon_fn(b_name), day_start, day_end
                )
            elif hit is not None:
                exact_map = _exact_aspects_today(
                    sky, a_name, sky.lon[b_name], sky.lon_fn(b_name),
                    day_start, day_end, only=(hit.aspect,),
                )
            else:
                exact_map = {}

            candidates = set(exact_map)
            if hit is not None:
                candidates.add(hit.aspect)

            for aspect_name in candidates:
                orb, applying = _measure(a_body, b_body, aspect_name)
                exact_jd = exact_map.get(aspect_name)
                exact_local = _local_str(exact_jd, tz) if exact_jd is not None else None
                score = _SKY_DISCOUNT * _score_aspect(
                    a_name, b_name, aspect_name, orb, applying, exact_jd is not None
                )
                record = {
                    "transit": a_name,
                    "other": b_name,
                    "aspect": aspect_name,
                    "orb": round(orb, 3),
                    "applying": applying,
                    "favorable": aspect_name in aspects.FAVORABLE_ASPECTS,
                    "layer": layer_of(a_name),
                    "exact_local": exact_local,
                    "score": round(score, 3),
                }
                sky_aspects.append(record)

                detail = _aspect_detail(orb, applying, exact_local)
                findings.append(
                    Finding(
                        kind="sky_aspect",
                        layer=layer_of(a_name),
                        score=score,
                        title=(
                            f"{PLANET_RU[a_name]} {_ASPECT_LOC[aspect_name]} "
                            f"к {_DATIVE[b_name]} (общий фон)"
                        ),
                        detail=detail,
                        meaning=meanings.sky_aspect_meaning(aspect_name),
                        time_local=exact_local,
                        data=record,
                    )
                )

    # --- discrete events in the 24 hours ---------------------------------- #
    events: list[dict] = []
    all_ingresses = _scan_ingresses(sky)

    for moment, name, from_sign, to_sign in sorted(all_ingresses):
        if not (day_start <= moment < day_end):
            continue
        score = _EVENT_SCORE["ingress_moon" if name == "Moon" else "ingress_planet"]
        record = {
            "kind": "ingress",
            "planet": name,
            "from_sign": dig.NUM_TO_SIGN[from_sign],
            "to_sign": dig.NUM_TO_SIGN[to_sign],
            "time_local": _local_str(moment, tz),
        }
        events.append(record)
        findings.append(
            Finding(
                kind="event", layer=layer_of(name), score=score,
                title=f"{PLANET_RU[name]} переходит в {_SIGN_ACC[to_sign]}",
                detail=f"из знака {_SIGN_NOM[from_sign]}",
                meaning=meanings.ingress_meaning(name),
                time_local=record["time_local"], data=record,
            )
        )

    for moment, name, retrograde in sorted(_scan_stations(sky)):
        if not (day_start <= moment < day_end):
            continue
        record = {
            "kind": "station",
            "planet": name,
            "retrograde": retrograde,
            "time_local": _local_str(moment, tz),
        }
        events.append(record)
        findings.append(
            Finding(
                kind="event", layer=layer_of(name), score=_EVENT_SCORE["station"],
                title=(
                    f"{PLANET_RU[name]} становится "
                    f"{'ретроградным' if retrograde else 'директным'}"
                ),
                detail="смена направления — тема этой планеты разворачивается",
                meaning=meanings.station_meaning(name, retrograde),
                time_local=record["time_local"], data=record,
            )
        )

    for moment, label in sorted(_scan_moon_phases(sky)):
        if not (day_start <= moment < day_end):
            continue
        major = label in ("Новолуние", "Полнолуние")
        moon_lon = aspects.body_at("Moon", moment).lon
        record = {
            "kind": "moon_phase",
            "phase": label,
            "sign": dig.NUM_TO_SIGN[dig.sign_num_of(moon_lon)],
            "time_local": _local_str(moment, tz),
        }
        events.append(record)
        findings.append(
            Finding(
                kind="event", layer=LAYER_TODAY,
                score=_EVENT_SCORE["moon_phase_major" if major else "moon_phase_minor"],
                title=f"{label} в знаке {_SIGN_LOC[dig.sign_num_of(moon_lon)]}",
                detail="точный момент фазы",
                meaning=meanings.moon_phase_meaning(label),
                time_local=record["time_local"], data=record,
            )
        )

    # --- void of course ---------------------------------------------------- #
    voids: list[dict] = []
    for start, end in _void_of_course_periods(sky, all_ingresses):
        if end <= day_start or start >= day_end:
            continue
        record = {
            "start_local": _local_str(start, tz),
            "end_local": _local_str(end, tz),
            "starts_before_day": start < day_start,
            "ends_after_day": end >= day_end,
        }
        voids.append(record)
        findings.append(
            Finding(
                kind="event", layer=LAYER_TODAY, score=_EVENT_SCORE["void_of_course"],
                title="Луна без курса",
                detail=(
                    f"с {record['start_local'][11:]} до {record['end_local'][11:]} — "
                    "время не для новых начинаний"
                ),
                meaning=meanings.VOID_OF_COURSE_MEANING,
                time_local=record["start_local"], data={"kind": "void_of_course", **record},
            )
        )

    # --- the Moon's own day ------------------------------------------------ #
    moon_start = aspects.body_at("Moon", day_start)
    moon_end = aspects.body_at("Moon", day_end)
    moon_ref = transiting_now["Moon"]
    moon = {
        **_sign_info(moon_ref.lon),
        **_moon_phase(moon_ref.lon, transiting_now["Sun"].lon),
        "sign_at_day_start": dig.NUM_TO_SIGN[dig.sign_num_of(moon_start.lon)],
        "sign_at_day_end": dig.NUM_TO_SIGN[dig.sign_num_of(moon_end.lon)],
        "natal_house": natal.house_of(moon_ref.lon),
        "void_of_course": voids,
        "speed": round(moon_ref.speed, 4),
    }

    # --- positions --------------------------------------------------------- #
    positions = [
        {
            "planet": name,
            **_sign_info(body.lon),
            "retrograde": body.retrograde,
            "speed": round(body.speed, 5),
            "natal_house": natal.house_of(body.lon),
        }
        for name, body in transiting_now.items()
    ]
    retrogrades = [name for name, body in transiting_now.items() if body.retrograde]

    # --- ranking ----------------------------------------------------------- #
    natal_aspects.sort(key=lambda r: r["score"], reverse=True)

    # Rolled up from the same findings and the same weights, so the scorecard
    # can never contradict the highlights printed above it.
    areas = life_areas.score_areas(
        natal_aspects,
        {name: natal.house_of(body.lon) for name, body in transiting_now.items()},
    )
    sky_aspects.sort(key=lambda r: r["score"], reverse=True)
    highlights = _rank_highlights(findings, max_highlights)

    return DailyComputation(
        date=target.strftime("%Y-%m-%d"),
        timezone=tz_str,
        latitude=lat,
        longitude=lon,
        reference_local=_local_str(reference, tz),
        reference_utc=_utc_from_jd(reference).strftime("%Y-%m-%dT%H:%M"),
        houses_known=houses_known,
        moon=moon,
        positions=positions,
        retrogrades=retrogrades,
        areas=areas,
        natal_aspects=natal_aspects,
        sky_aspects=sky_aspects,
        events=events,
        highlights=highlights,
    )


# How many of the highlights may come from the slow background layer. Without a
# cap, a chart under a long Pluto transit would surface the same three lines
# every single morning.
_MAX_BACKGROUND_HIGHLIGHTS = 1


def _rank_highlights(findings: Sequence[Finding], limit: int) -> list[dict]:
    """Top findings, with the slow background layer capped."""
    ordered = sorted(findings, key=lambda f: f.score, reverse=True)
    chosen: list[Finding] = []
    background = 0
    for finding in ordered:
        if len(chosen) >= limit:
            break
        if finding.layer == LAYER_BACKGROUND:
            if background >= _MAX_BACKGROUND_HIGHLIGHTS:
                continue
            background += 1
        chosen.append(finding)
    return [f.as_dict() for f in chosen]
