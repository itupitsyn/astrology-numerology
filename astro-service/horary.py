"""Horary chart computation and deterministic judgment.

A horary chart is cast for the *moment a question is received*, using
Regiomontanus houses (the traditional horary standard). The verdict —
yes / no / qualified, with timing — is computed here in Python from the
classical rules (perfection, translation, collection, prohibition,
refranation), never by an LLM. The interpretation layer only narrates the
verdict this module already decided.

Positions and speeds come from Swiss Ephemeris directly (via pyswisseph),
using the exact Julian day kerykeion computed for the chart, so the geometry
is consistent with the displayed chart.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import swisseph as swe
from kerykeion import AstrologicalSubject

import dignities as dig
from geocoding import resolve_timezone

logger = logging.getLogger("astro-service.horary")

# Swiss Ephemeris ids for the seven classical planets.
_SWE_ID = {
    "Sun": swe.SUN,
    "Moon": swe.MOON,
    "Mercury": swe.MERCURY,
    "Venus": swe.VENUS,
    "Mars": swe.MARS,
    "Jupiter": swe.JUPITER,
    "Saturn": swe.SATURN,
}

# Ptolemaic aspects: name -> exact angle.
ASPECT_ANGLES = {
    "conjunction": 0.0,
    "sextile": 60.0,
    "square": 90.0,
    "trine": 120.0,
    "opposition": 180.0,
}
# Which aspects are inherently easy vs hard (for colouring the verdict).
FAVORABLE_ASPECTS = {"sextile", "trine"}
HARD_ASPECTS = {"square", "opposition"}

# Lilly's orbs (whole degrees); an aspect is "within orb" when the two bodies
# are closer than the mean of their two orbs (sum of moieties).
LILLY_ORB = {
    "Sun": 15.0, "Moon": 12.0, "Mercury": 7.0, "Venus": 7.0,
    "Mars": 8.0, "Jupiter": 9.0, "Saturn": 9.0,
}

# Via combusta: 15 Libra .. 15 Scorpio, in absolute ecliptic longitude.
_VIA_COMBUSTA = (195.0, 225.0)

# Numeric step (days) used to detect whether an aspect is applying.
_DT = 0.02


def _moiety_sum(p1: str, p2: str) -> float:
    return (LILLY_ORB[p1] + LILLY_ORB[p2]) / 2.0


def _norm360(x: float) -> float:
    return x % 360.0


def _separation(lon1: float, lon2: float) -> float:
    """Angular separation in [0, 180]."""
    d = abs(lon1 - lon2) % 360.0
    return d if d <= 180.0 else 360.0 - d


@dataclass
class Body:
    """A moving point: ecliptic longitude and daily motion."""

    name: str
    lon: float
    speed: float  # degrees/day; negative = retrograde

    @property
    def retrograde(self) -> bool:
        return self.speed < 0

    def lon_at(self, days: float) -> float:
        return _norm360(self.lon + self.speed * days)

    def sign_num(self) -> int:
        return dig.sign_num_of(self.lon)

    def exits_sign_within(self, days: float) -> bool:
        """True if the body leaves its current sign within `days` (>0)."""
        if days <= 0:
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


def find_aspect(b1: Body, b2: Body) -> Optional[AspectHit]:
    """Return the operative aspect between two bodies, if any is within orb.

    Applying/separating is determined numerically from the two bodies' motion;
    for an applying aspect we also compute time/degrees to exact and whether it
    perfects before either body leaves its sign.
    """
    moiety = _moiety_sum(b1.name, b2.name)
    sep_now = _separation(b1.lon, b2.lon)

    best: Optional[tuple[str, float]] = None  # (aspect, orb)
    for name, angle in ASPECT_ANGLES.items():
        orb = abs(sep_now - angle)
        if orb <= moiety and (best is None or orb < best[1]):
            best = (name, orb)
    if best is None:
        return None

    aspect, orb = best
    angle = ASPECT_ANGLES[aspect]

    # Numeric derivative of the orb to classify applying vs separating.
    sep_next = _separation(b1.lon_at(_DT), b2.lon_at(_DT))
    orb_next = abs(sep_next - angle)
    applying = orb_next < orb

    days: Optional[float] = None
    degs: Optional[float] = None
    perfects_before_exit = False
    if applying and orb > 1e-9:
        rate = (orb - orb_next) / _DT  # degrees/day the orb closes
        if rate > 1e-9:
            days = orb / rate
            degs = orb
            perfects_before_exit = not (
                b1.exits_sign_within(days) or b2.exits_sign_within(days)
            )

    return AspectHit(
        p1=b1.name,
        p2=b2.name,
        aspect=aspect,
        orb=orb,
        applying=applying,
        days_to_perfect=days,
        degrees_to_perfect=degs,
        perfects_before_sign_exit=perfects_before_exit,
        favorable=aspect in FAVORABLE_ASPECTS,
    )


# --------------------------------------------------------------------------- #
# Moon analysis
# --------------------------------------------------------------------------- #
@dataclass
class MoonState:
    void_of_course: bool
    via_combusta: bool
    next_aspect: Optional[AspectHit]
    last_aspect: Optional[AspectHit]

    def as_dict(self) -> dict:
        return {
            "void_of_course": self.void_of_course,
            "via_combusta": self.via_combusta,
            "next_aspect": self.next_aspect.as_dict() if self.next_aspect else None,
            "last_aspect": self.last_aspect.as_dict() if self.last_aspect else None,
        }


def analyse_moon(moon: Body, others: dict[str, Body]) -> MoonState:
    """Void-of-course and the Moon's next/last classical aspect.

    The Moon is void of course when it forms no further applying Ptolemaic
    aspect (perfecting before it leaves its current sign) to any classical
    planet.
    """
    applying: list[AspectHit] = []
    separating: list[AspectHit] = []
    for name, body in others.items():
        if name == "Moon":
            continue
        hit = find_aspect(moon, body)
        if hit is None:
            continue
        if hit.applying and hit.perfects_before_sign_exit:
            applying.append(hit)
        elif not hit.applying:
            separating.append(hit)

    next_aspect = min(
        applying,
        key=lambda h: h.days_to_perfect if h.days_to_perfect is not None else 1e9,
        default=None,
    )
    last_aspect = min(separating, key=lambda h: h.orb, default=None)

    via = _VIA_COMBUSTA[0] <= moon.lon < _VIA_COMBUSTA[1]

    return MoonState(
        void_of_course=next_aspect is None,
        via_combusta=via,
        next_aspect=next_aspect,
        last_aspect=last_aspect,
    )


# --------------------------------------------------------------------------- #
# Verdict engine
# --------------------------------------------------------------------------- #
@dataclass
class Judgment:
    verdict: str                      # "yes" | "no" | "qualified"
    perfection_mode: Optional[str]    # direct/translation/collection/moon/none
    timing_days: Optional[float]
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "perfection_mode": self.perfection_mode,
            "timing_days": None if self.timing_days is None else round(self.timing_days, 2),
            "reasons": self.reasons,
        }


def _translation(
    querent: Body, quesited: Body, others: dict[str, Body]
) -> Optional[tuple[Body, AspectHit]]:
    """A faster planet separating from one significator and applying to the
    other translates the light between them."""
    sig_names = {querent.name, quesited.name}
    for name, body in others.items():
        if name in sig_names:
            continue
        to_q = find_aspect(body, querent)
        to_qu = find_aspect(body, quesited)
        if to_q is None or to_qu is None:
            continue
        # Separating from one, applying to the other, and faster than both.
        if abs(body.speed) <= abs(querent.speed) and abs(body.speed) <= abs(quesited.speed):
            continue
        if to_q.applying != to_qu.applying:
            applied = to_q if to_q.applying else to_qu
            if applied.perfects_before_sign_exit:
                return body, applied
    return None


def _collection(
    querent: Body, quesited: Body, others: dict[str, Body]
) -> Optional[tuple[Body, AspectHit, AspectHit]]:
    """A slower planet that both significators apply to collects their light."""
    sig_names = {querent.name, quesited.name}
    for name, body in others.items():
        if name in sig_names:
            continue
        to_q = find_aspect(querent, body)
        to_qu = find_aspect(quesited, body)
        if to_q is None or to_qu is None:
            continue
        if not (to_q.applying and to_qu.applying):
            continue
        if abs(body.speed) >= abs(querent.speed) or abs(body.speed) >= abs(quesited.speed):
            continue
        if to_q.perfects_before_sign_exit and to_qu.perfects_before_sign_exit:
            return body, to_q, to_qu
    return None


def _prohibition(
    querent: Body,
    quesited: Body,
    direct: AspectHit,
    others: dict[str, Body],
) -> Optional[Body]:
    """A third planet that perfects an aspect to a significator *before* the
    direct L1-Lq aspect completes intercepts (prohibits) the matter."""
    if direct.days_to_perfect is None:
        return None
    sig_names = {querent.name, quesited.name}
    for name, body in others.items():
        if name in sig_names:
            continue
        for sig in (querent, quesited):
            hit = find_aspect(body, sig)
            if hit and hit.applying and hit.days_to_perfect is not None:
                if hit.perfects_before_sign_exit and hit.days_to_perfect < direct.days_to_perfect:
                    return body
    return None


def judge(
    querent: Body,
    quesited: Body,
    moon: MoonState,
    moon_body: Body,
    others: dict[str, Body],
    is_day: bool,
) -> Judgment:
    """Deterministic horary verdict from the classical perfection modes."""
    reasons: list[str] = []

    # Reception can soften a hard aspect or an otherwise weak perfection.
    rec = dig.receptions(querent.name, querent.lon, quesited.name, quesited.lon, is_day)

    direct = find_aspect(querent, quesited)

    # 1) Direct perfection between the two significators.
    if direct and direct.applying and direct.perfects_before_sign_exit:
        proh = _prohibition(querent, quesited, direct, others)
        if proh is not None:
            reasons.append(
                f"Прохибиция: {proh.name} завершает аспект к сигнификатору раньше, "
                f"чем перфектируется {querent.name}–{quesited.name}."
            )
            return Judgment("no", "prohibition", None, reasons)

        favorable = direct.favorable or direct.aspect == "conjunction"
        reasons.append(
            f"Прямая перфекция: {querent.name} {direct.aspect} {quesited.name}, "
            f"applying, {direct.degrees_to_perfect:.1f}° до точного, "
            f"перфектируется до смены знака."
        )
        if rec["mutual"]:
            reasons.append("Взаимная рецепция между сигнификаторами — сильное содействие.")
        if favorable or rec["mutual"]:
            return Judgment("yes", "direct", direct.days_to_perfect, reasons)
        # Hard aspect without mutual reception: possible but with difficulty.
        reasons.append("Аспект напряжённый (квадрат/оппозиция), без взаимной рецепции — с усилиями.")
        verdict = "qualified" if (rec["p1_receives_p2"] or rec["p2_receives_p1"]) else "no"
        return Judgment(verdict, "direct", direct.days_to_perfect, reasons)

    # 2) Translation of light.
    tr = _translation(querent, quesited, others)
    if tr is not None:
        carrier, applied = tr
        reasons.append(
            f"Перенос света: {carrier.name} переносит свет между сигнификаторами "
            f"(applying {applied.aspect}, {applied.degrees_to_perfect:.1f}°)."
        )
        return Judgment("yes", "translation", applied.days_to_perfect, reasons)

    # 3) Collection of light.
    col = _collection(querent, quesited, others)
    if col is not None:
        collector, h1, h2 = col
        slowest = max(
            (d for d in (h1.days_to_perfect, h2.days_to_perfect) if d is not None),
            default=None,
        )
        reasons.append(
            f"Собирание света: {collector.name} собирает свет обоих сигнификаторов."
        )
        return Judgment("yes", "collection", slowest, reasons)

    # 4) Moon corroboration — Moon applying to the quesited significator.
    if moon.next_aspect and quesited.name in (moon.next_aspect.p1, moon.next_aspect.p2):
        reasons.append(
            f"Луна применительно к сигнификатору вопроса ({moon.next_aspect.aspect}) — "
            f"косвенное содействие."
        )
        verdict = "qualified"
        if moon.void_of_course:
            verdict = "no"
        return Judgment(verdict, "moon", moon.next_aspect.days_to_perfect, reasons)

    # 5) No perfection.
    if moon.void_of_course:
        reasons.append("Луна без курса — как правило, «ничего не выйдет».")
    else:
        reasons.append("Между сигнификаторами нет применительного аспекта и нет переноса/собирания света.")
    return Judgment("no", "none", None, reasons)


# --------------------------------------------------------------------------- #
# Chart assembly
# --------------------------------------------------------------------------- #
@dataclass
class HoraryComputation:
    """Everything the response/interpretation layers need."""

    subject: AstrologicalSubject
    is_day: bool
    querent_house: int
    quesited_house: int
    querent_sig: str
    quesited_sig: str
    bodies: dict[str, Body]
    moon_state: MoonState
    judgment: Judgment
    querent_dignity: dig.DignityState
    quesited_dignity: dig.DignityState
    receptions: dict


def _bodies_from_swe(julian_day: float) -> dict[str, Body]:
    bodies: dict[str, Body] = {}
    flags = swe.FLG_SWIEPH | swe.FLG_SPEED
    for name, pid in _SWE_ID.items():
        res = swe.calc_ut(julian_day, pid, flags)
        lon, _lat, _dist, slon, *_ = res[0]
        bodies[name] = Body(name=name, lon=_norm360(lon), speed=slon)
    return bodies


def _house_cusp_sign_num(subject: AstrologicalSubject, house_num: int) -> int:
    attr = (
        "first_house second_house third_house fourth_house fifth_house sixth_house "
        "seventh_house eighth_house ninth_house tenth_house eleventh_house twelfth_house"
    ).split()[house_num - 1]
    cusp = getattr(subject, attr)
    return int(getattr(cusp, "sign_num"))


def _house_number(house_name: Optional[str]) -> Optional[int]:
    if not house_name:
        return None
    order = (
        "First_House Second_House Third_House Fourth_House Fifth_House Sixth_House "
        "Seventh_House Eighth_House Ninth_House Tenth_House Eleventh_House Twelfth_House"
    ).split()
    return order.index(house_name) + 1 if house_name in order else None


def compute_horary(
    *,
    question_house: int,
    latitude: float,
    longitude: float,
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    timezone: Optional[str] = None,
    querent_house: int = 1,
) -> HoraryComputation:
    """Cast the horary chart and compute the deterministic judgment."""
    tz_str = timezone or resolve_timezone(latitude, longitude)

    subject = AstrologicalSubject(
        name="Horary",
        year=year, month=month, day=day, hour=hour, minute=minute,
        lng=longitude, lat=latitude, tz_str=tz_str,
        city="N/A", zodiac_type="Tropic",
        houses_system_identifier="R",  # Regiomontanus — the horary standard.
        online=False,
    )

    bodies = _bodies_from_swe(subject.julian_day)

    # Sect: Sun above the horizon (houses 7..12) = day chart.
    sun_house = _house_number(getattr(subject.sun, "house", None))
    is_day = sun_house is not None and 7 <= sun_house <= 12

    querent_sig = dig.ruler_of_sign(_house_cusp_sign_num(subject, querent_house))
    quesited_sig = dig.ruler_of_sign(_house_cusp_sign_num(subject, question_house))

    q_body = bodies[querent_sig]
    qu_body = bodies[quesited_sig]
    moon_body = bodies["Moon"]

    moon_state = analyse_moon(moon_body, bodies)

    # If querent and quesited resolve to the same planet (e.g. both ruled by
    # the same sign), the significators coincide — treat as immediate assent.
    if querent_sig == quesited_sig:
        judgment = Judgment(
            "yes", "same-ruler", 0.0,
            [f"Кверент и предмет вопроса имеют одного управителя ({querent_sig}) — "
             f"дела тесно связаны."],
        )
    else:
        judgment = judge(q_body, qu_body, moon_state, moon_body, bodies, is_day)

    return HoraryComputation(
        subject=subject,
        is_day=is_day,
        querent_house=querent_house,
        quesited_house=question_house,
        querent_sig=querent_sig,
        quesited_sig=quesited_sig,
        bodies=bodies,
        moon_state=moon_state,
        judgment=judgment,
        querent_dignity=dig.essential_dignities(querent_sig, q_body.lon, is_day),
        quesited_dignity=dig.essential_dignities(quesited_sig, qu_body.lon, is_day),
        receptions=dig.receptions(querent_sig, q_body.lon, quesited_sig, qu_body.lon, is_day),
    )
