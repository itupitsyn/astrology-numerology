"""FastAPI entrypoint for the astrology microservice.

Endpoints:
  GET  /health            — liveness + Nominatim reachability
  POST /geocode           — free-form place -> coordinates + timezone (local Nominatim)
  POST /natal             — birth data -> full natal chart (kerykeion / Swiss Ephemeris)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from datetime import datetime

import pytz

from config import Settings, get_settings
from ephemeris import compute_natal_chart, serialize_chart
from geocoding import GeocodingService, NominatimError, resolve_timezone
from horary import HoraryComputation, _house_number, compute_horary
from models import (
    AspectHitInfo,
    BirthData,
    DignityInfo,
    GeocodeRequest,
    GeocodeResponse,
    HealthResponse,
    HoraryChart,
    HoraryJudgment,
    HoraryQuestion,
    MoonStateInfo,
    NatalChart,
    RadicalityFlags,
    ReceptionInfo,
    Significator,
)

logging.basicConfig(level=get_settings().log_level)
logger = logging.getLogger("astro-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Single shared geocoding client for the app lifetime.
    app.state.geocoding = GeocodingService()
    logger.info("astro-service started")
    try:
        yield
    finally:
        await app.state.geocoding.aclose()
        logger.info("astro-service stopped")


app = FastAPI(
    title="Astro Service",
    description="Natal chart + geocoding microservice (kerykeion, Swiss Ephemeris, local Nominatim).",
    version="1.0.0",
    lifespan=lifespan,
)

# The Nuxt/Nitro layer calls this service; allow it during local development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_geocoding(request: Request) -> GeocodingService:
    return request.app.state.geocoding


@app.get("/health", response_model=HealthResponse)
async def health(
    settings: Settings = Depends(get_settings),
    geocoding: GeocodingService = Depends(get_geocoding),
) -> HealthResponse:
    return HealthResponse(
        service=settings.service_name,
        nominatim_reachable=await geocoding.ping(),
    )


@app.post("/geocode", response_model=GeocodeResponse)
async def geocode(
    payload: GeocodeRequest,
    geocoding: GeocodingService = Depends(get_geocoding),
) -> GeocodeResponse:
    try:
        results = await geocoding.search(
            query=payload.query,
            limit=payload.limit,
            language=payload.language,
        )
    except NominatimError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return GeocodeResponse(query=payload.query, results=results)


@app.post("/natal", response_model=NatalChart)
async def natal(payload: BirthData) -> NatalChart:
    try:
        return compute_natal_chart(payload)
    except Exception as exc:  # noqa: BLE001 - surface calc errors as 400 to the caller
        logger.exception("Natal chart computation failed")
        raise HTTPException(status_code=400, detail=f"Chart computation failed: {exc}") from exc


def _significator(role: str, house: int, planet: str, comp: HoraryComputation, dignity) -> Significator:
    body = comp.bodies[planet]
    subj_point = getattr(comp.subject, planet.lower())
    return Significator(
        role=role,
        house=house,
        planet=planet,
        sign=getattr(subj_point, "sign", "?"),
        position=round(body.lon % 30, 4),
        abs_position=round(body.lon, 4),
        house_of_planet=_house_number(getattr(subj_point, "house", None)),
        retrograde=body.retrograde,
        speed=round(body.speed, 5),
        dignity=DignityInfo(**dignity.as_dict()),
    )


def _build_horary_response(question: str, comp: HoraryComputation) -> HoraryChart:
    subject = comp.subject
    tz_str = subject.tz_str
    chart = serialize_chart(
        subject,
        name="Horary",
        latitude=subject.lat,
        longitude=subject.lng,
        tz_str=tz_str,
        zodiac_type="Tropic",
        houses_system="R",
    )

    asc_deg = float(getattr(subject.first_house, "position", 0.0))
    saturn_house = _house_number(getattr(subject.saturn, "house", None))

    radicality = RadicalityFlags(
        ascendant_too_early=asc_deg < 3.0,
        ascendant_too_late=asc_deg > 27.0,
        moon_void_of_course=comp.moon_state.void_of_course,
        moon_via_combusta=comp.moon_state.via_combusta,
        saturn_in_first_or_seventh=saturn_house in (1, 7),
    )

    ms = comp.moon_state.as_dict()

    return HoraryChart(
        question=question,
        quesited_house=comp.quesited_house,
        querent_house=comp.querent_house,
        is_day_chart=comp.is_day,
        moment_utc=str(getattr(subject, "iso_formatted_utc_datetime", "")),
        moment_local=str(getattr(subject, "iso_formatted_local_datetime", "")),
        timezone=tz_str,
        latitude=subject.lat,
        longitude=subject.lng,
        chart=chart,
        querent=_significator("querent", comp.querent_house, comp.querent_sig, comp, comp.querent_dignity),
        quesited=_significator("quesited", comp.quesited_house, comp.quesited_sig, comp, comp.quesited_dignity),
        moon=MoonStateInfo(
            void_of_course=ms["void_of_course"],
            via_combusta=ms["via_combusta"],
            next_aspect=AspectHitInfo(**ms["next_aspect"]) if ms["next_aspect"] else None,
            last_aspect=AspectHitInfo(**ms["last_aspect"]) if ms["last_aspect"] else None,
        ),
        receptions=ReceptionInfo(**comp.receptions),
        radicality=radicality,
        judgment=HoraryJudgment(**comp.judgment.as_dict()),
    )


@app.post("/horary", response_model=HoraryChart)
async def horary(payload: HoraryQuestion) -> HoraryChart:
    tz_str = payload.timezone or resolve_timezone(payload.latitude, payload.longitude)

    moment_fields = (payload.year, payload.month, payload.day, payload.hour, payload.minute)
    if payload.ask_now or any(f is None for f in moment_fields):
        # pytz (via kerykeion) rather than zoneinfo: no system tzdata on Windows.
        now = datetime.now(pytz.timezone(tz_str))
        year, month, day, hour, minute = now.year, now.month, now.day, now.hour, now.minute
    else:
        year, month, day, hour, minute = moment_fields  # type: ignore[assignment]

    try:
        comp = compute_horary(
            question_house=payload.quesited_house,
            querent_house=payload.querent_house,
            latitude=payload.latitude,
            longitude=payload.longitude,
            year=year, month=month, day=day, hour=hour, minute=minute,
            timezone=tz_str,
        )
        return _build_horary_response(payload.question, comp)
    except Exception as exc:  # noqa: BLE001 - surface calc errors as 400 to the caller
        logger.exception("Horary computation failed")
        raise HTTPException(status_code=400, detail=f"Horary computation failed: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
