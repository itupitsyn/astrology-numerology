"""Geocoding against a self-hosted Nominatim instance + timezone resolution.

Lookups go to a **primary** Nominatim server (`NOMINATIM_URL`, a self-hosted
regional instance). If the primary has no match for a query — or is unreachable
— and a **fallback** is configured (`NOMINATIM_FALLBACK_URL`, e.g. a separate
full-planet instance or the public OSM one), the query is retried there so
out-of-region places still resolve. Timezones are derived offline from
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
    """Raised when a Nominatim instance is unreachable or errors out."""


class GeocodingService:
    """Async client for Nominatim /search with an optional fallback instance."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        headers = {"User-Agent": self._settings.nominatim_user_agent}
        self._client = httpx.AsyncClient(
            base_url=self._settings.nominatim_url,
            timeout=self._settings.geocoding_timeout,
            headers=headers,
        )
        # Optional secondary instance for regions the primary doesn't cover.
        self._fallback: httpx.AsyncClient | None = None
        if self._settings.nominatim_fallback_url:
            self._fallback = httpx.AsyncClient(
                base_url=self._settings.nominatim_fallback_url,
                timeout=self._settings.geocoding_timeout,
                headers=headers,
            )

    async def aclose(self) -> None:
        await self._client.aclose()
        if self._fallback is not None:
            await self._fallback.aclose()

    async def ping(self) -> bool:
        """Best-effort reachability check for the primary /status endpoint."""
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
        """Geocode a free-form query, trying the primary then the fallback."""
        results = await self._search_one(self._client, query, limit, language, is_primary=True)
        if results or self._fallback is None:
            return results
        logger.info("No primary match for %r; retrying via fallback Nominatim", query)
        return await self._search_one(self._fallback, query, limit, language, is_primary=False)

    async def _search_one(
        self,
        client: httpx.AsyncClient,
        query: str,
        limit: int,
        language: str | None,
        is_primary: bool,
    ) -> list[GeoLocation]:
        """Query a single Nominatim instance.

        On a primary failure with a fallback configured, return `[]` so the
        caller routes to the fallback rather than surfacing the error. Any other
        failure raises `NominatimError`.
        """
        params = {
            "q": query,
            "format": "jsonv2",
            "limit": limit,
            "addressdetails": 0,
            "accept-language": language or self._settings.geocoding_language,
        }
        try:
            resp = await client.get("/search", params=params)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            if is_primary and self._fallback is not None:
                logger.warning("Primary Nominatim failed (%s); trying fallback", exc)
                return []
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
