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
# Horary chart
# --------------------------------------------------------------------------- #
class HoraryQuestion(BaseModel):
    """Input for a horary judgment.

    The chart is cast for the *moment the question is received*. Supply the
    moment explicitly (year..minute), or set `ask_now=True` to use the current
    time at the given location. `quesited_house` is the house the question is
    about (2=money, 7=partner/marriage, 10=career, ...); the caller (web layer)
    maps a friendly question category to this house.
    """

    question: str = Field(..., min_length=1, description="The question, free text.")
    quesited_house: int = Field(..., ge=1, le=12, description="House the question is about.")
    querent_house: int = Field(1, ge=1, le=12, description="Querent's house (almost always 1).")

    ask_now: bool = Field(False, description="Ignore the moment fields and use current time at the location.")
    year: Optional[int] = Field(None, ge=1, le=3000)
    month: Optional[int] = Field(None, ge=1, le=12)
    day: Optional[int] = Field(None, ge=1, le=31)
    hour: Optional[int] = Field(None, ge=0, le=23)
    minute: Optional[int] = Field(None, ge=0, le=59)

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    timezone: Optional[str] = Field(None, description="IANA timezone. If omitted, resolved from coordinates.")
    city: Optional[str] = Field(None, description="Optional place label (cosmetic).")


class DignityInfo(BaseModel):
    planet: str
    domicile: bool
    exaltation: bool
    triplicity: bool
    term: bool
    face: bool
    detriment: bool
    fall: bool
    peregrine: bool
    score: int = Field(..., description="Lilly essential-dignity score (sum of dignities/debilities).")


class AspectHitInfo(BaseModel):
    p1: str
    p2: str
    aspect: str
    orb: float = Field(..., description="Current orb from exact, degrees.")
    applying: bool
    days_to_perfect: Optional[float] = None
    degrees_to_perfect: Optional[float] = None
    perfects_before_sign_exit: bool = False
    favorable: bool = False


class MoonStateInfo(BaseModel):
    void_of_course: bool
    via_combusta: bool = Field(..., description="Moon between 15° Libra and 15° Scorpio.")
    next_aspect: Optional[AspectHitInfo] = None
    last_aspect: Optional[AspectHitInfo] = None


class ReceptionInfo(BaseModel):
    p1_receives_p2: list[str] = Field(default_factory=list, description="Dignities by which the querent's sig receives the quesited's.")
    p2_receives_p1: list[str] = Field(default_factory=list)
    mutual: bool = False


class Significator(BaseModel):
    role: str = Field(..., description="'querent' or 'quesited'.")
    house: int = Field(..., description="House this significator rules for the question.")
    planet: str
    sign: str
    position: float = Field(..., description="Degrees within the sign (0..30).")
    abs_position: float
    house_of_planet: Optional[int] = Field(None, description="House the significator planet occupies.")
    retrograde: bool = False
    speed: float = Field(..., description="Daily motion in longitude, degrees/day.")
    dignity: DignityInfo


class HoraryJudgment(BaseModel):
    verdict: str = Field(..., description="'yes' | 'no' | 'qualified'.")
    perfection_mode: Optional[str] = Field(None, description="direct | translation | collection | moon | prohibition | refranation | same-ruler | none.")
    timing_days: Optional[float] = Field(None, description="Approx. degrees-to-perfection as a raw time hint (days).")
    reasons: list[str] = Field(default_factory=list, description="Human-readable factors behind the verdict (Russian).")


class RadicalityFlags(BaseModel):
    ascendant_too_early: bool = Field(..., description="Asc < 3° of its sign — question may be premature.")
    ascendant_too_late: bool = Field(..., description="Asc > 27° of its sign — matter too far gone / already decided.")
    moon_void_of_course: bool
    moon_via_combusta: bool
    saturn_in_first_or_seventh: bool = Field(..., description="Classic caution against judging the chart.")


class HoraryChart(BaseModel):
    """Full horary result: the visual chart + significators + deterministic judgment."""

    question: str
    quesited_house: int
    querent_house: int
    is_day_chart: bool
    moment_utc: str
    moment_local: str
    timezone: str
    latitude: float
    longitude: float

    chart: NatalChart = Field(..., description="The cast chart (Regiomontanus houses) for display.")
    querent: Significator
    quesited: Significator
    moon: MoonStateInfo
    receptions: ReceptionInfo
    radicality: RadicalityFlags
    judgment: HoraryJudgment


# --------------------------------------------------------------------------- #
# Daily transits
# --------------------------------------------------------------------------- #
class PlaceRef(BaseModel):
    """Where the person is *now* — not where they were born."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    timezone: Optional[str] = Field(None, description="IANA timezone. If omitted, resolved from coordinates.")
    city: Optional[str] = Field(None, description="Optional place label (cosmetic).")


class DailyRequest(BaseModel):
    """Input for a daily forecast.

    The day is always the *local* day at `place` — a user in Vladivostok must
    not be handed yesterday's sky because the server is in UTC. Omit `date` to
    mean "today there".
    """

    birth: BirthData
    place: Optional[PlaceRef] = Field(
        None,
        description="Current location; drives the day boundary and local event times. Defaults to the birth place.",
    )
    date: Optional[str] = Field(
        None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Local calendar date (YYYY-MM-DD). Defaults to today at `place`.",
    )
    reference_hour: int = Field(12, ge=0, le=23, description="Hour the snapshot positions are taken at.")
    reference_minute: int = Field(0, ge=0, le=59)
    max_highlights: int = Field(5, ge=1, le=20, description="How many ranked findings to return.")
    houses_known: bool = Field(
        True,
        description=(
            "False when the birth time is unknown. Houses and the angles sweep the whole "
            "zodiac every 24 hours, so without a birth time they are meaningless rather "
            "than imprecise: they are then omitted instead of computed from a placeholder."
        ),
    )


class TransitPosition(BaseModel):
    planet: str
    sign: str
    sign_num: int
    sign_ru: str
    position: float = Field(..., description="Degrees within the sign (0..30).")
    abs_position: float
    retrograde: bool
    speed: float = Field(..., description="Daily motion in longitude, degrees/day.")
    natal_house: Optional[int] = Field(
        None,
        description="Natal house this transiting body falls in. Null when the birth time is unknown.",
    )


class DailyAspect(BaseModel):
    """A transit aspecting a natal point, or another transiting body."""

    transit: str
    natal: Optional[str] = Field(None, description="Natal point aspected (transit->natal only).")
    other: Optional[str] = Field(None, description="Other transiting body (sky aspects only).")
    aspect: str
    orb: float
    applying: bool
    favorable: bool
    retrograde: bool = False
    layer: str = Field(..., description="'today' (Moon..Mars) or 'background' (Jupiter and beyond).")
    exact_local: Optional[str] = Field(None, description="Local time the aspect perfects, if it does so today.")
    score: float = Field(..., description="Deterministic relevance rank for the day.")


class DailyEvent(BaseModel):
    """A discrete moment inside the 24 hours (ingress, station, lunar phase)."""

    kind: str = Field(..., description="'ingress' | 'station' | 'moon_phase'.")
    time_local: str
    planet: Optional[str] = None
    from_sign: Optional[str] = None
    to_sign: Optional[str] = None
    retrograde: Optional[bool] = None
    phase: Optional[str] = None
    sign: Optional[str] = None


class VoidOfCourse(BaseModel):
    start_local: str
    end_local: str
    starts_before_day: bool = Field(..., description="The period began before this local day.")
    ends_after_day: bool = Field(..., description="The period runs past this local day.")


class MoonToday(BaseModel):
    sign: str
    sign_num: int
    sign_ru: str
    position: float
    abs_position: float
    phase_angle: float = Field(..., description="Moon minus Sun, 0..360.")
    phase_name: str
    illumination: float = Field(..., description="Illuminated fraction of the disc, 0..1.")
    waxing: bool
    sign_at_day_start: str
    sign_at_day_end: str
    natal_house: Optional[int] = Field(
        None, description="Null when the birth time is unknown."
    )
    speed: float
    void_of_course: list[VoidOfCourse] = Field(default_factory=list)


class Highlight(BaseModel):
    """One ranked thing worth saying about the day.

    This is the part a bot can send instantly, before any LLM has run: it is
    already prioritised, already phrased in Russian, and costs no GPU.
    """

    kind: str = Field(..., description="'natal_aspect' | 'sky_aspect' | 'event'.")
    layer: str
    score: float
    title: str = Field(..., description="The chart-level fact, e.g. 'Луна в квадрате к натальному Плутону'.")
    detail: str
    meaning: Optional[str] = Field(
        None,
        description=(
            "What it means for an ordinary day, in plain language — the part a reader "
            "actually wants, with `title` as the receipt behind it. Phrased as a tendency, "
            "never as an event that will happen. Null where no everyday reading applies."
        ),
    )
    time_local: Optional[str] = None
    data: dict = Field(default_factory=dict, description="Machine-readable source record.")


class DailyForecast(BaseModel):
    date: str
    timezone: str
    latitude: float
    longitude: float
    reference_local: str
    reference_utc: str
    houses_known: bool = Field(
        ...,
        description="False when the birth time was unknown: no houses, no Ascendant/MC.",
    )

    moon: MoonToday
    positions: list[TransitPosition]
    retrogrades: list[str]
    natal_aspects: list[DailyAspect] = Field(..., description="Transits to the natal chart, ranked.")
    sky_aspects: list[DailyAspect] = Field(..., description="Transit-to-transit aspects — the general weather.")
    events: list[DailyEvent]
    highlights: list[Highlight] = Field(..., description="The ranked shortlist to actually show.")


# --------------------------------------------------------------------------- #
# Common
# --------------------------------------------------------------------------- #
class HealthResponse(BaseModel):
    status: str = "ok"
    service: str
    nominatim_reachable: bool
