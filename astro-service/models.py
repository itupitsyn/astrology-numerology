"""Pydantic schemas shared across the service (requests & responses)."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Geocoding
# --------------------------------------------------------------------------- #
class GeocodeRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Free-form place name, e.g. 'Москва, Россия'.")
    limit: int = Field(5, ge=1, le=20, description="Max number of candidates to return.")
    language: Optional[str] = Field(None, description="Override default result language (e.g. 'en', 'ru').")


class GeoLocation(BaseModel):
    display_name: str = Field(..., description="Full human-readable place name from Nominatim.")
    latitude: float
    longitude: float
    timezone: str = Field(..., description="IANA timezone resolved from coordinates, e.g. 'Europe/Moscow'.")
    place_id: Optional[int] = None
    osm_type: Optional[str] = None
    osm_id: Optional[int] = None
    type: Optional[str] = Field(None, description="Nominatim place class/type, e.g. 'city'.")


class GeocodeResponse(BaseModel):
    query: str
    results: list[GeoLocation]


# --------------------------------------------------------------------------- #
# Natal chart
# --------------------------------------------------------------------------- #
class BirthData(BaseModel):
    """Input for a natal chart calculation.

    Coordinates and timezone may be supplied directly, or derived from `city`
    via the /geocode step on the caller's side. If `timezone` is omitted it is
    resolved from latitude/longitude.
    """

    name: str = Field("Subject", description="Label for the chart owner.")
    year: int = Field(..., ge=1, le=3000)
    month: int = Field(..., ge=1, le=12)
    day: int = Field(..., ge=1, le=31)
    hour: int = Field(..., ge=0, le=23)
    minute: int = Field(..., ge=0, le=59)

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    timezone: Optional[str] = Field(
        None,
        description="IANA timezone. If omitted, resolved from coordinates.",
    )
    city: Optional[str] = Field(None, description="Optional city label (cosmetic, not used for lookup).")


class CelestialPoint(BaseModel):
    name: str
    sign: str = Field(..., description="Zodiac sign name, e.g. 'Tau'.")
    sign_num: int = Field(..., description="Sign index 0..11 (Aries=0).")
    position: float = Field(..., description="Degrees within the sign (0..30).")
    abs_position: float = Field(..., description="Absolute ecliptic longitude (0..360).")
    house: Optional[str] = Field(None, description="House name the point falls in.")
    retrograde: bool = False
    element: Optional[str] = None
    quality: Optional[str] = None
    emoji: Optional[str] = None


class House(BaseModel):
    name: str
    sign: str
    sign_num: int
    position: float
    abs_position: float


class Aspect(BaseModel):
    p1_name: str
    p2_name: str
    aspect: str = Field(..., description="Aspect name, e.g. 'trine'.")
    orbit: float = Field(..., description="Deviation from exact aspect, in degrees.")
    aspect_degrees: float
    diff: float


class LunarPhase(BaseModel):
    degrees_between_sun_moon: Optional[float] = None
    moon_phase: Optional[int] = Field(None, description="Phase index 1..28 (kerykeion).")
    sun_phase: Optional[int] = None
    moon_phase_name: Optional[str] = None


class NatalChart(BaseModel):
    name: str
    birth_datetime_utc: str
    birth_datetime_local: str
    timezone: str
    latitude: float
    longitude: float
    zodiac_type: str
    houses_system: str

    planets: list[CelestialPoint]
    axes: list[CelestialPoint] = Field(
        default_factory=list,
        description="Chart axes: Ascendant, Medium Coeli, etc.",
    )
    houses: list[House]
    aspects: list[Aspect]
    lunar_phase: LunarPhase


# --------------------------------------------------------------------------- #
# Common
# --------------------------------------------------------------------------- #
class HealthResponse(BaseModel):
    status: str = "ok"
    service: str
    nominatim_reachable: bool
