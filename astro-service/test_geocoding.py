"""Tests for the geocoding rate limiter, cache and request coalescing.

These guard the public-Nominatim budget (1 req/s per application), which is the
kind of thing that silently degrades into a ban rather than failing loudly.

Written against plain pytest — no pytest-asyncio needed, each async case is
driven through `asyncio.run`. Also runnable directly:  python test_geocoding.py
"""

from __future__ import annotations

import asyncio
import time

import pytest

from config import Settings
from geocoding import (
    GeocodingBusy,
    GeocodingService,
    NominatimError,
    _RateLimiter,
    _TTLCache,
)
from models import GeoLocation


def _place(name: str = "Москва") -> GeoLocation:
    return GeoLocation(
        display_name=name,
        latitude=55.7558,
        longitude=37.6173,
        timezone="Europe/Moscow",
    )


# --------------------------------------------------------------------------
# _RateLimiter
# --------------------------------------------------------------------------


def test_limiter_spaces_calls():
    """Consecutive acquires are spaced by at least the configured interval."""

    async def scenario() -> list[float]:
        limiter = _RateLimiter(rate_per_sec=20, max_wait=0)  # 50 ms apart
        stamps = []
        for _ in range(4):
            await limiter.acquire()
            stamps.append(time.monotonic())
        return stamps

    stamps = asyncio.run(scenario())
    gaps = [b - a for a, b in zip(stamps, stamps[1:])]
    # Allow a little slack for scheduler jitter, but the spacing must be real.
    assert all(gap >= 0.045 for gap in gaps), gaps


def test_limiter_disabled_when_rate_is_zero():
    """rate_per_sec=0 means a self-hosted instance: no spacing at all."""

    async def scenario() -> float:
        limiter = _RateLimiter(rate_per_sec=0, max_wait=5)
        assert not limiter.enabled
        started = time.monotonic()
        for _ in range(50):
            await limiter.acquire()
        return time.monotonic() - started

    assert asyncio.run(scenario()) < 0.1


def test_limiter_is_fifo():
    """Waiters are served in arrival order, not at random."""

    async def scenario() -> list[int]:
        limiter = _RateLimiter(rate_per_sec=50, max_wait=0)  # 20 ms apart
        served: list[int] = []

        async def caller(n: int) -> None:
            await limiter.acquire()
            served.append(n)

        # Spawn in order, with a beat between them so arrival order is defined.
        tasks = []
        for n in range(5):
            tasks.append(asyncio.create_task(caller(n)))
            await asyncio.sleep(0)
        await asyncio.gather(*tasks)
        return served

    assert asyncio.run(scenario()) == [0, 1, 2, 3, 4]


def test_limiter_rejects_when_queue_too_long():
    """A caller that would wait longer than max_wait fails fast instead."""

    async def scenario() -> None:
        # 1 req/s, willing to wait 2s -> a queue of 3 already exceeds it.
        limiter = _RateLimiter(rate_per_sec=1, max_wait=2.0)
        tasks = [asyncio.create_task(limiter.acquire()) for _ in range(4)]
        await asyncio.sleep(0.05)  # let them all enter the queue

        assert limiter.queued >= 3
        with pytest.raises(GeocodingBusy):
            await limiter.acquire()

        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    asyncio.run(scenario())


# --------------------------------------------------------------------------
# _TTLCache
# --------------------------------------------------------------------------


def test_cache_hit_and_miss():
    cache = _TTLCache(maxsize=10, ttl=60)
    assert cache.get(("москва", 5, "ru")) is None
    cache.set(("москва", 5, "ru"), [_place()])
    assert cache.get(("москва", 5, "ru"))[0].display_name == "Москва"


def test_cache_expires():
    cache = _TTLCache(maxsize=10, ttl=0.05)
    cache.set(("москва", 5, "ru"), [_place()])
    time.sleep(0.06)
    assert cache.get(("москва", 5, "ru")) is None


def test_cache_evicts_least_recently_used():
    cache = _TTLCache(maxsize=2, ttl=60)
    cache.set(("a", 5, "ru"), [_place("A")])
    cache.set(("b", 5, "ru"), [_place("B")])
    cache.get(("a", 5, "ru"))          # refresh "a", making "b" the oldest
    cache.set(("c", 5, "ru"), [_place("C")])

    assert cache.get(("b", 5, "ru")) is None
    assert cache.get(("a", 5, "ru")) is not None
    assert cache.get(("c", 5, "ru")) is not None


def test_cache_disabled_when_maxsize_zero():
    cache = _TTLCache(maxsize=0, ttl=60)
    cache.set(("a", 5, "ru"), [_place()])
    assert cache.get(("a", 5, "ru")) is None
    assert len(cache) == 0


# --------------------------------------------------------------------------
# GeocodingService: caching and coalescing
# --------------------------------------------------------------------------


def _service(**overrides) -> GeocodingService:
    values = {
        "nominatim_url": "http://primary.invalid",
        "nominatim_fallback_url": "",
        "nominatim_rate_limit": 0.0,
        "nominatim_fallback_rate_limit": 0.0,
    }
    values.update(overrides)
    return GeocodingService(Settings(**values))


def test_identical_concurrent_queries_hit_upstream_once():
    """Autocomplete bursts must not each spend a slice of the budget."""

    async def scenario() -> int:
        service = _service()
        calls = 0

        async def fake_search_one(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)  # keep the request in flight
            return [_place()]

        service._search_one = fake_search_one  # type: ignore[assignment]
        results = await asyncio.gather(*(service.search("Москва") for _ in range(6)))
        await service.aclose()

        assert all(r[0].display_name == "Москва" for r in results)
        return calls

    assert asyncio.run(scenario()) == 1


def test_repeat_query_served_from_cache():
    async def scenario() -> int:
        service = _service()
        calls = 0

        async def fake_search_one(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            return [_place()]

        service._search_one = fake_search_one  # type: ignore[assignment]
        await service.search("Москва")
        # Different spacing/case must still hit the same cache entry.
        await service.search("  МОСКВА  ")
        await service.aclose()
        return calls

    assert asyncio.run(scenario()) == 1


def test_empty_result_is_cached():
    """A query matching nothing must not be retried on every keystroke."""

    async def scenario() -> int:
        service = _service()
        calls = 0

        async def fake_search_one(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            return []

        service._search_one = fake_search_one  # type: ignore[assignment]
        assert await service.search("щщщщ") == []
        assert await service.search("щщщщ") == []
        await service.aclose()
        return calls

    assert asyncio.run(scenario()) == 1


def test_cancelled_caller_does_not_kill_the_shared_request():
    """One client giving up must not fail the others waiting on the same query."""

    async def scenario() -> list[GeoLocation]:
        service = _service()

        async def fake_search_one(*_args, **_kwargs):
            await asyncio.sleep(0.05)
            return [_place()]

        service._search_one = fake_search_one  # type: ignore[assignment]

        quitter = asyncio.create_task(service.search("Москва"))
        stayer = asyncio.create_task(service.search("Москва"))
        await asyncio.sleep(0.01)
        quitter.cancel()

        result = await stayer
        await service.aclose()
        return result

    assert asyncio.run(scenario())[0].display_name == "Москва"


# --------------------------------------------------------------------------
# Two-instance merge: a regional primary must not hide the rest of the world
# --------------------------------------------------------------------------


def _two_source_service(**overrides) -> GeocodingService:
    return _service(nominatim_fallback_url="http://fallback.invalid", **overrides)


def _odessa_ua() -> GeoLocation:
    return GeoLocation(
        display_name="Одеса, Одеська область, Україна",
        latitude=46.4843,
        longitude=30.7323,
        timezone="Europe/Kyiv",
        osm_type="relation",
        osm_id=1,
    )


def _odessa_tx() -> GeoLocation:
    return GeoLocation(
        display_name="Odessa, Ector County, Texas, United States",
        latitude=31.8457,
        longitude=-102.3676,
        timezone="America/Chicago",
        osm_type="relation",
        osm_id=2,
    )


def _patch_sources(service: GeocodingService, primary, fallback):
    """Route _search_one to canned per-instance results."""

    async def fake_search_one(client, _limiter, *_args, **_kwargs):
        source = primary if client is service._client else fallback
        if isinstance(source, BaseException):
            raise source
        return list(source)

    service._search_one = fake_search_one  # type: ignore[assignment]


def test_regional_hit_does_not_hide_the_rest_of_the_world():
    """The bug this merge exists for: Odessa TX must survive Odessa UA."""

    async def scenario() -> list[GeoLocation]:
        service = _two_source_service()
        _patch_sources(service, primary=[_odessa_ua()], fallback=[_odessa_tx()])
        results = await service.search("Odessa")
        await service.aclose()
        return results

    results = asyncio.run(scenario())
    assert [p.osm_id for p in results] == [1, 2]
    # And the timezone that would have been silently wrong is present.
    assert "America/Chicago" in {p.timezone for p in results}


def test_merge_deduplicates_the_same_place_from_both_instances():
    async def scenario() -> list[GeoLocation]:
        service = _two_source_service()
        _patch_sources(service, primary=[_odessa_ua()], fallback=[_odessa_ua(), _odessa_tx()])
        results = await service.search("Odessa")
        await service.aclose()
        return results

    assert [p.osm_id for p in asyncio.run(scenario())] == [1, 2]


def test_merge_respects_limit():
    async def scenario() -> list[GeoLocation]:
        service = _two_source_service()
        many = [
            GeoLocation(
                display_name=f"P{n}", latitude=float(n), longitude=0.0,
                timezone="UTC", osm_type="node", osm_id=100 + n,
            )
            for n in range(5)
        ]
        _patch_sources(service, primary=many, fallback=[_odessa_tx()])
        results = await service.search("x", limit=3)
        await service.aclose()
        return results

    results = asyncio.run(scenario())
    assert len(results) == 3
    # Interleaved, so the fallback still gets a seat at a tight limit.
    assert 2 in [p.osm_id for p in results]


def test_merge_survives_one_instance_failing():
    async def scenario() -> list[GeoLocation]:
        service = _two_source_service()
        _patch_sources(service, primary=NominatimError("primary down"),
                       fallback=[_odessa_tx()])
        results = await service.search("Odessa")
        await service.aclose()
        return results

    assert [p.osm_id for p in asyncio.run(scenario())] == [2]


def test_merge_raises_when_both_instances_fail():
    async def scenario() -> None:
        service = _two_source_service()
        _patch_sources(service, primary=NominatimError("primary down"),
                       fallback=NominatimError("fallback down"))
        with pytest.raises(NominatimError):
            await service.search("Odessa")
        await service.aclose()

    asyncio.run(scenario())


def test_legacy_mode_stops_at_the_primary():
    """The old behaviour still available behind the flag — and still biased."""

    async def scenario() -> list[GeoLocation]:
        service = _two_source_service(geocoding_merge_sources=False)
        _patch_sources(service, primary=[_odessa_ua()], fallback=[_odessa_tx()])
        results = await service.search("Odessa")
        await service.aclose()
        return results

    assert [p.osm_id for p in asyncio.run(scenario())] == [1]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
