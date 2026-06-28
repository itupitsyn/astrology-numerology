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

    # --- Local Nominatim ---
    # Base URL of the self-hosted Nominatim instance (no trailing slash).
    nominatim_url: str = "http://localhost:8080"
    # User-Agent is required by Nominatim policy even for local installs.
    nominatim_user_agent: str = "astro-service/1.0"
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
