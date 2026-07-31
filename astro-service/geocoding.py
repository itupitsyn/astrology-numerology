"""Geocoding against Nominatim + timezone resolution.

Lookups go to a **primary** Nominatim server (`NOMINATIM_URL`). When a
**fallback** is configured (`NOMINATIM_FALLBACK_URL`, e.g. the public OSM
instance), both are queried and their results are merged — see
`_merge_sources` for why "primary first, fallback only if empty" is wrong for
a birth-place picker. Timezones are derived offline from coordinates with
`timezonefinder`.

Outbound requests are **rate limited and queued per instance**. The public OSM
Nominatim allows at most 1 request per second *per application*, counted across
all users, so the budget has to be enforced here — in one shared place on the
server — rather than per browser session. Three mechanisms keep us inside it:

* a FIFO queue that spaces outbound calls (`_RateLimiter`),
* a TTL cache, since birth places repeat heavily and a cache hit costs no
  budget at all (`_TTLCache`),
* collapsing identical concurrent queries into a single upstream request.

NOTE: all three are per-process. They are exact only while astro-service runs a
single uvicorn worker, which is how the Dockerfile starts it. If you ever add
`--workers`, each worker gets its own budget and the 1 req/s guarantee breaks —
the limiter would have to move to something shared (Redis, or a single-flight
sidecar).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from itertools import zip_longest

import httpx
from timezonefinder import TimezoneFinder

from config import Settings, get_settings
from models import GeoLocation

logger = logging.getLogger("astro-service.geocoding")

# TimezoneFinder loads a sizeable lookup table; build it once per process.
_tf = TimezoneFinder()

# (normalised query, limit, language) — everything that changes the response.
CacheKey = tuple[str, int, str]


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


def _identity(place: GeoLocation) -> tuple:
    """Stable key for de-duplicating the same place seen on two instances."""
    if place.osm_type and place.osm_id is not None:
        return (place.osm_type, place.osm_id)
    # Different instances can assign different place_ids to the same object, so
    # fall back to geometry + name rather than trusting place_id.
    return (place.display_name, round(place.latitude, 5), round(place.longitude, 5))


def _merge_sources(
    primary: list[GeoLocation],
    fallback: list[GeoLocation],
    limit: int,
) -> list[GeoLocation]:
    """Interleave two result sets, de-duplicated, primary first on each round.

    Why merge at all: with a *regional* primary, "return primary results, only
    ask the fallback when primary is empty" silently truncates the world to one
    region. A user born in Odessa, Texas types "Odessa", the CIS instance
    confidently answers with Odessa, Ukraine, and the search stops there. The
    result looks right — correct name, plausible entry — so the user picks it
    and gets a natal chart computed from the wrong coordinates and, worse, the
    wrong timezone. Nothing errors out. Same trap for Saint Petersburg,
    Moscow, Paris.

    Why round-robin instead of sorting by Nominatim's `importance`: the two
    instances may be built differently — ours imports without the Wikipedia
    ranking data, the public one has it — so their scores are not on a common
    scale and sorting by them would just reintroduce a bias, in whichever
    direction. Interleaving guarantees both sources are visible in the list the
    user actually sees, and each source keeps its own internal ranking. The
    country is already part of `display_name`, so the choice is the user's.
    """
    merged: list[GeoLocation] = []
    seen: set[tuple] = set()
    for pair in zip_longest(primary, fallback):
        for place in pair:
            if place is None:
                continue
            key = _identity(place)
            if key in seen:
                continue
            seen.add(key)
            merged.append(place)
    return merged[:limit]


class NominatimError(RuntimeError):
    """Raised when a Nominatim instance is unreachable or errors out."""


class GeocodingBusy(RuntimeError):
    """Raised when the outbound queue is longer than we are willing to wait.

    Surfaced as 503 rather than 502: the request was never sent upstream, and
    retrying shortly is the right move.
    """


class _TTLCache:
    """Small LRU cache with per-entry expiry.

    Not thread-safe, and does not need to be: everything runs on one event loop
    and the methods never await.
    """

    def __init__(self, maxsize: int, ttl: float) -> None:
        self._maxsize = maxsize
        self._ttl = ttl
        self._entries: OrderedDict[CacheKey, tuple[float, list[GeoLocation]]] = OrderedDict()

    def get(self, key: CacheKey) -> list[GeoLocation] | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= time.monotonic():
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return value

    def set(self, key: CacheKey, value: list[GeoLocation]) -> None:
        if self._maxsize <= 0:
            return
        self._entries[key] = (time.monotonic() + self._ttl, value)
        self._entries.move_to_end(key)
        while len(self._entries) > self._maxsize:
            self._entries.popitem(last=False)

    def __len__(self) -> int:
        return len(self._entries)


class _RateLimiter:
    """Serialises outbound calls and spaces them by at least `min_interval`.

    `asyncio.Lock` hands out ownership in FIFO order, so waiters are served in
    arrival order — the queue is fair, not a stampede.
    """

    def __init__(self, rate_per_sec: float, max_wait: float) -> None:
        self._min_interval = 1.0 / rate_per_sec if rate_per_sec > 0 else 0.0
        self._max_wait = max_wait
        self._lock = asyncio.Lock()
        self._next_slot = 0.0
        self._queued = 0

    @property
    def enabled(self) -> bool:
        return self._min_interval > 0

    @property
    def queued(self) -> int:
        return self._queued

    async def acquire(self) -> None:
        """Wait for this caller's turn, or raise `GeocodingBusy` if the queue is
        already longer than `max_wait` allows."""
        if not self.enabled:
            return

        # Reject before joining the queue rather than letting callers pile up.
        # A request that would wait ten seconds is worthless anyway — the user
        # has typed three more characters by then.
        if self._max_wait > 0 and self._queued * self._min_interval > self._max_wait:
            raise GeocodingBusy(
                f"geocoding queue is full ({self._queued} waiting, "
                f"{self._min_interval:.1f}s apart)"
            )

        self._queued += 1
        try:
            async with self._lock:
                delay = self._next_slot - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                self._next_slot = time.monotonic() + self._min_interval
        finally:
            self._queued -= 1


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
        self._limiter = _RateLimiter(
            self._settings.nominatim_rate_limit,
            self._settings.geocoding_queue_max_wait,
        )
        # Optional secondary instance for regions the primary doesn't cover.
        self._fallback: httpx.AsyncClient | None = None
        self._fallback_limiter = _RateLimiter(
            self._settings.nominatim_fallback_rate_limit,
            self._settings.geocoding_queue_max_wait,
        )
        if self._settings.nominatim_fallback_url:
            self._fallback = httpx.AsyncClient(
                base_url=self._settings.nominatim_fallback_url,
                timeout=self._settings.geocoding_timeout,
                headers=headers,
            )

        self._cache = _TTLCache(
            self._settings.geocoding_cache_size,
            self._settings.geocoding_cache_ttl,
        )
        # Queries currently in flight, so duplicates can share one response.
        self._inflight: dict[CacheKey, asyncio.Task[list[GeoLocation]]] = {}

    async def aclose(self) -> None:
        await self._client.aclose()
        if self._fallback is not None:
            await self._fallback.aclose()

    async def ping(self) -> bool:
        """Best-effort reachability check for the primary /status endpoint.

        Deliberately skips the rate limiter: /health must stay responsive even
        when the geocoding queue is saturated, and it is not a search.
        """
        try:
            resp = await self._client.get("/status", params={"format": "json"})
            return resp.status_code == 200
        except httpx.HTTPError as exc:
            logger.debug("Nominatim ping failed: %s", exc)
            return False

    def _cache_key(self, query: str, limit: int, language: str | None) -> CacheKey:
        return (
            " ".join(query.split()).casefold(),
            limit,
            language or self._settings.geocoding_language,
        )

    async def search(
        self,
        query: str,
        limit: int = 5,
        language: str | None = None,
    ) -> list[GeoLocation]:
        """Geocode a free-form query, served from cache when possible."""
        key = self._cache_key(query, limit, language)

        cached = self._cache.get(key)
        if cached is not None:
            logger.debug("Geocoding cache hit for %r", key[0])
            return cached

        # Collapse identical concurrent queries into one upstream request. With
        # a 1 req/s budget a burst of duplicates is pure waste, and autocomplete
        # produces exactly such bursts.
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._fetch(key, query, limit, language))
            self._inflight[key] = task
            task.add_done_callback(self._forget_inflight)
        # shield() so a caller that gives up (browser navigated away, request
        # cancelled) does not cancel the shared task other callers are awaiting.
        return await asyncio.shield(task)

    def _forget_inflight(self, task: asyncio.Task[list[GeoLocation]]) -> None:
        for key, running in list(self._inflight.items()):
            if running is task:
                del self._inflight[key]
                break
        # Retrieve any exception so Python does not log it as never-retrieved
        # when every awaiter has already been cancelled.
        if not task.cancelled():
            task.exception()

    async def _fetch(
        self,
        key: CacheKey,
        query: str,
        limit: int,
        language: str | None,
    ) -> list[GeoLocation]:
        """Run the lookup across the configured instances and cache the result."""
        if self._fallback is None:
            results = await self._search_one(
                self._client, self._limiter, query, limit, language, swallow_errors=False
            )
        elif self._settings.geocoding_merge_sources:
            results = await self._search_merged(query, limit, language)
        else:
            # Legacy "regional first" behaviour, kept behind a flag for a setup
            # whose primary already covers the whole planet. See _merge_sources
            # for why this is the wrong default.
            results = await self._search_one(
                self._client, self._limiter, query, limit, language, swallow_errors=True
            )
            if not results:
                logger.info("No primary match for %r; retrying via fallback Nominatim", query)
                results = await self._search_one(
                    self._fallback, self._fallback_limiter, query, limit, language,
                    swallow_errors=False,
                )

        # Empty results are cached too: a typo that matches nothing should not
        # be allowed to spend the budget again on every keystroke.
        self._cache.set(key, results)
        return results

    async def _search_merged(
        self,
        query: str,
        limit: int,
        language: str | None,
    ) -> list[GeoLocation]:
        """Query both instances concurrently and merge what came back.

        Concurrent because the two have independent rate-limit queues, so
        waiting for them in sequence would add both delays for no reason.
        One instance failing is tolerated — we serve what the other found and
        log it, since a degraded list beats no answer. Only a total failure
        raises.
        """
        primary_call = self._search_one(
            self._client, self._limiter, query, limit, language, swallow_errors=False
        )
        fallback_call = self._search_one(
            self._fallback, self._fallback_limiter, query, limit, language, swallow_errors=False
        )
        primary, fallback = await asyncio.gather(
            primary_call, fallback_call, return_exceptions=True
        )

        failures = [r for r in (primary, fallback) if isinstance(r, BaseException)]
        if len(failures) == 2:
            raise failures[0]
        for failure in failures:
            # Note this is exactly the situation the merge exists to prevent:
            # the surviving list is region-biased again. Worth seeing in logs.
            logger.warning("Geocoding source failed for %r, results may be partial: %s",
                           query, failure)

        return _merge_sources(
            primary if isinstance(primary, list) else [],
            fallback if isinstance(fallback, list) else [],
            limit,
        )

    async def _search_one(
        self,
        client: httpx.AsyncClient,
        limiter: _RateLimiter,
        query: str,
        limit: int,
        language: str | None,
        swallow_errors: bool,
    ) -> list[GeoLocation]:
        """Query a single Nominatim instance, waiting for a rate-limit slot.

        `swallow_errors` turns a transport failure into `[]` instead of an
        exception. That is what the sequential primary→fallback path needs, so
        a dead primary routes onward rather than failing the request. The merge
        path passes False: there both instances are queried regardless, so a
        real exception is more useful than a silent empty list — it is how the
        caller knows the merged list is region-biased.

        `GeocodingBusy` propagates untouched either way: it means our own queue
        is saturated, and retrying elsewhere would not help.
        """
        params = {
            "q": query,
            "format": "jsonv2",
            "limit": limit,
            "addressdetails": 0,
            "accept-language": language or self._settings.geocoding_language,
        }
        await limiter.acquire()
        try:
            resp = await client.get("/search", params=params)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            if swallow_errors:
                logger.warning("Nominatim instance failed (%s); routing onward", exc)
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
