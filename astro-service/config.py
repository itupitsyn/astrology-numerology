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

    # --- Nominatim (primary: self-hosted regional instance) ---
    # Base URL of the self-hosted Nominatim instance (no trailing slash).
    nominatim_url: str = "http://localhost:8080"
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

    # --- Ephemeris ---
    # House system passed to Swiss Ephemeris (single-letter code).
    # P = Placidus, K = Koch, W = Whole Sign, R = Regiomontanus, ...
    houses_system: str = "P"
    # Zodiac type: "Tropic" or "Sidereal".
    zodiac_type: str = "Tropic"


@lru_cache
def get_settings() -> Settings:
    return Settings()
