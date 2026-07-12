"""Natal chart computation via kerykeion / Swiss Ephemeris.

Runs fully offline: coordinates and timezone are supplied by the caller (from
the geocoding step), so kerykeion never needs network access.
"""

from __future__ import annotations

import logging
from typing import Any

from kerykeion import AstrologicalSubject, NatalAspects

from config import Settings, get_settings
from geocoding import resolve_timezone
from models import (
    Aspect,
    BirthData,
    CelestialPoint,
    House,
    LunarPhase,
    NatalChart,
)

logger = logging.getLogger("astro-service.ephemeris")

# Planet/point attributes exposed by kerykeion's AstrologicalSubject.
_PLANET_ATTRS = (
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
    "mean_node",
    "true_node",
    "mean_south_node",
    "true_south_node",
    "chiron",
    "mean_lilith",
)

# Chart axes (angles) exposed as house cusps / dedicated points.
_AXIS_ATTRS = (
    "ascendant",
    "medium_coeli",
    "descendant",
    "imum_coeli",
)

_HOUSE_ATTRS = (
    "first_house",
    "second_house",
    "third_house",
    "fourth_house",
    "fifth_house",
    "sixth_house",
    "seventh_house",
    "eighth_house",
    "ninth_house",
    "tenth_house",
    "eleventh_house",
    "twelfth_house",
)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Read an attribute from a kerykeion point (object or dict)."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _to_point(point: Any) -> CelestialPoint:
    return CelestialPoint(
        name=_get(point, "name", "?"),
        sign=_get(point, "sign", "?"),
        sign_num=int(_get(point, "sign_num", 0) or 0),
        position=round(float(_get(point, "position", 0.0) or 0.0), 4),
        abs_position=round(float(_get(point, "abs_pos", 0.0) or 0.0), 4),
        house=_get(point, "house"),
        retrograde=bool(_get(point, "retrograde", False)),
        element=_get(point, "element"),
        quality=_get(point, "quality"),
        emoji=_get(point, "emoji"),
    )


def _to_house(point: Any) -> House:
    return House(
        name=_get(point, "name", "?"),
        sign=_get(point, "sign", "?"),
        sign_num=int(_get(point, "sign_num", 0) or 0),
        position=round(float(_get(point, "position", 0.0) or 0.0), 4),
        abs_position=round(float(_get(point, "abs_pos", 0.0) or 0.0), 4),
    )


def _to_aspect(asp: Any) -> Aspect:
    return Aspect(
        p1_name=_get(asp, "p1_name", "?"),
        p2_name=_get(asp, "p2_name", "?"),
        aspect=_get(asp, "aspect", "?"),
        orbit=round(float(_get(asp, "orbit", 0.0) or 0.0), 4),
        aspect_degrees=round(float(_get(asp, "aspect_degrees", 0.0) or 0.0), 4),
        diff=round(float(_get(asp, "diff", 0.0) or 0.0), 4),
    )


def _lunar_phase(subject: AstrologicalSubject) -> LunarPhase:
    lp = getattr(subject, "lunar_phase", None)
    if lp is None:
        return LunarPhase()
    return LunarPhase(
        degrees_between_sun_moon=_get(lp, "degrees_between_s_m"),
        moon_phase=_get(lp, "moon_phase"),
        sun_phase=_get(lp, "sun_phase"),
        moon_phase_name=_get(lp, "moon_phase_name"),
    )


def serialize_chart(
    subject: AstrologicalSubject,
    *,
    name: str,
    latitude: float,
    longitude: float,
    tz_str: str,
    zodiac_type: str,
    houses_system: str,
) -> NatalChart:
    """Serialize an already-built kerykeion subject into a NatalChart.

    Shared by the natal and horary paths so the visual chart (planets, axes,
    houses, aspects, lunar phase) is produced identically regardless of the
    house system the subject was cast with.
    """
    planets = [_to_point(_get(subject, attr)) for attr in _PLANET_ATTRS if _get(subject, attr) is not None]
    axes = [_to_point(_get(subject, attr)) for attr in _AXIS_ATTRS if _get(subject, attr) is not None]
    houses = [_to_house(_get(subject, attr)) for attr in _HOUSE_ATTRS if _get(subject, attr) is not None]

    try:
        raw_aspects = NatalAspects(subject).relevant_aspects
        aspects = [_to_aspect(a) for a in raw_aspects]
    except Exception as exc:  # noqa: BLE001 - aspects are non-critical, never fail the chart
        logger.warning("Aspect computation failed: %s", exc)
        aspects = []

    return NatalChart(
        name=name,
        birth_datetime_utc=str(_get(subject, "iso_formatted_utc_datetime", "")),
        birth_datetime_local=str(_get(subject, "iso_formatted_local_datetime", "")),
        timezone=tz_str,
        latitude=latitude,
        longitude=longitude,
        zodiac_type=zodiac_type,
        houses_system=houses_system,
        planets=planets,
        axes=axes,
        houses=houses,
        aspects=aspects,
        lunar_phase=_lunar_phase(subject),
    )


def compute_natal_chart(birth: BirthData, settings: Settings | None = None) -> NatalChart:
    """Compute a natal chart from birth data.

    Timezone is taken from `birth.timezone` if provided, otherwise resolved
    offline from the coordinates.
    """
    settings = settings or get_settings()
    tz_str = birth.timezone or resolve_timezone(birth.latitude, birth.longitude)

    subject = AstrologicalSubject(
        name=birth.name,
        year=birth.year,
        month=birth.month,
        day=birth.day,
        hour=birth.hour,
        minute=birth.minute,
        lng=birth.longitude,
        lat=birth.latitude,
        tz_str=tz_str,
        city=birth.city or "N/A",
        zodiac_type=settings.zodiac_type,
        houses_system_identifier=settings.houses_system,
        online=False,
    )

    return serialize_chart(
        subject,
        name=birth.name,
        latitude=birth.latitude,
        longitude=birth.longitude,
        tz_str=tz_str,
        zodiac_type=settings.zodiac_type,
        houses_system=settings.houses_system,
    )
