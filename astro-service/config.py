"""Application configuration loaded from environment variables / .env file."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Service ---
    service_name: str = "astro-service"
    log_level: str = "INFO"

    # --- Nominatim (primary) ---
    # Base URL of the Nominatim instance to query (no trailing slash). The
    # deployed default is the public OSM instance — see nominatim_rate_limit.
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    # User-Agent is required by Nominatim policy even for local installs. If the
    # fallback below points at the public OSM instance this MUST carry a real
    # contact, or that instance returns 403.
    nominatim_user_agent: str = "astro-service/1.0"
    # --- Nominatim (fallback: other regions / rest of world) ---
    # Optional. When the primary returns no match — or is unreachable — the
    # query is retried here (a secondary instance or the public OSM Nominatim).
    # Leave empty to disable fallback and use the primary only.
    nominatim_fallback_url: str = ""
    # Network timeout for geocoding requests, in seconds.
    geocoding_timeout: float = 10.0
    # Default language for returned place names.
    geocoding_language: str = "ru"

    # --- Geocoding throughput ---
    # Outbound budget per instance, in requests/second; 0 disables limiting.
    # Defaults to 1.0 to match the public-OSM default above, whose policy is
    # 1 req/s per APPLICATION counted across all users. Set to 0 only when
    # nominatim_url points at an instance you own.
    nominatim_rate_limit: float = 1.0
    nominatim_fallback_rate_limit: float = 1.0
    # Query BOTH instances and merge, instead of stopping at the first that
    # returns anything. Required for correctness whenever the primary covers
    # only a region: otherwise a same-named city inside the region hides the
    # one the user actually meant (Odessa UA vs Odessa TX), and the resulting
    # chart is computed from the wrong coordinates and timezone. Costs one
    # extra upstream call per cache miss. Only set False when the primary
    # already covers the whole planet.
    geocoding_merge_sources: bool = True
    # How long a request may sit in the outbound queue before it is rejected
    # with 503 instead. 0 waits indefinitely. Keep this well under the client's
    # own timeout — a queued autocomplete request is stale long before then.
    geocoding_queue_max_wait: float = 8.0
    # In-process result cache. Birth places repeat heavily across users, which
    # is what makes a 1 req/s budget workable at all. 0 disables the cache.
    geocoding_cache_size: int = 5000
    geocoding_cache_ttl: float = 86400.0

    # --- Ephemeris ---
    # House system passed to Swiss Ephemeris (single-letter code).
    # P = Placidus, K = Koch, W = Whole Sign, R = Regiomontanus, ...
    houses_system: str = "P"
    # Zodiac type: "Tropic" or "Sidereal".
    zodiac_type: str = "Tropic"


@lru_cache
def get_settings() -> Settings:
    return Settings()
