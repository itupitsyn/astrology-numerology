"""Geocoding against a self-hosted Nominatim instance + timezone resolution.

No third-party geocoding APIs are used: all lookups go to the local Nominatim
server configured via `NOMINATIM_URL`. Timezones are derived offline from
coordinates with `timezonefinder`.
"""

from __future__ import annotations

import logging

import httpx
from timezonefinder import TimezoneFinder

from config import Settings, get_settings
from models import GeoLocation

logger = logging.getLogger("astro-service.geocoding")

# TimezoneFinder loads a sizeable lookup table; build it once per process.
_tf = TimezoneFinder()


def resolve_timezone(latitude: float, longitude: float) -> str:
    """Return the IANA timezone name for coordinates, offline.

    Falls back to 'UTC' for points with no defined timezone (e.g. open ocean).
    """
    tz = _tf.timezone_at(lat=latitude, lng=longitude)
    if not tz:
        # Edge of coverage — try the nearest land timezone before giving up.
        tz = _tf.closest_timezone_at(lat=latitude, lng=longitude)
    if not tz:
        logger.warning("No timezone found for (%s, %s); defaulting to UTC", latitude, longitude)
        return "UTC"
    return tz


class NominatimError(RuntimeError):
    """Raised when the local Nominatim instance is unreachable or errors out."""


class GeocodingService:
    """Thin async client for the local Nominatim /search endpoint."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._client = httpx.AsyncClient(
            base_url=self._settings.nominatim_url,
            timeout=self._settings.geocoding_timeout,
            headers={"User-Agent": self._settings.nominatim_user_agent},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def ping(self) -> bool:
        """Best-effort reachability check for the /health endpoint."""
        try:
            resp = await self._client.get("/status", params={"format": "json"})
            return resp.status_code == 200
        except httpx.HTTPError as exc:
            logger.debug("Nominatim ping failed: %s", exc)
            return False

    async def search(
        self,
        query: str,
        limit: int = 5,
        language: str | None = None,
    ) -> list[GeoLocation]:
        """Geocode a free-form query into a list of candidate locations."""
        params = {
            "q": query,
            "format": "jsonv2",
            "limit": limit,
            "addressdetails": 0,
            "accept-language": language or self._settings.geocoding_language,
        }
        try:
            resp = await self._client.get("/search", params=params)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise NominatimError(f"Nominatim request failed: {exc}") from exc

        results: list[GeoLocation] = []
        for item in resp.json():
            try:
                lat = float(item["lat"])
                lon = float(item["lon"])
            except (KeyError, TypeError, ValueError):
                logger.warning("Skipping malformed Nominatim item: %r", item)
                continue

            results.append(
                GeoLocation(
                    display_name=item.get("display_name", query),
                    latitude=lat,
                    longitude=lon,
                    timezone=resolve_timezone(lat, lon),
                    place_id=item.get("place_id"),
                    osm_type=item.get("osm_type"),
                    osm_id=item.get("osm_id"),
                    type=item.get("type"),
                )
            )
        return results
