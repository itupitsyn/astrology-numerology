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

from config import Settings, get_settings
from ephemeris import compute_natal_chart
from geocoding import GeocodingService, NominatimError
from models import (
    BirthData,
    GeocodeRequest,
    GeocodeResponse,
    HealthResponse,
    NatalChart,
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
