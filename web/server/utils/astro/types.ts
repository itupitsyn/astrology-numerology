/**
 * TypeScript mirror of the Python astro-service schemas (astro-service/models.py).
 * Keep in sync if the Python models change.
 */

// --- Geocoding ---
export interface GeoLocation {
  display_name: string
  latitude: number
  longitude: number
  timezone: string
  place_id?: number | null
  osm_type?: string | null
  osm_id?: number | null
  type?: string | null
}

export interface GeocodeRequest {
  query: string
  limit?: number
  language?: string | null
}

export interface GeocodeResponse {
  query: string
  results: GeoLocation[]
}

// --- Natal chart ---
export interface BirthData {
  name?: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  latitude: number
  longitude: number
  timezone?: string | null
  city?: string | null
}

export interface CelestialPoint {
  name: string
  sign: string
  sign_num: number
  position: number
  abs_position: number
  house?: string | null
  retrograde: boolean
  element?: string | null
  quality?: string | null
  emoji?: string | null
}

export interface House {
  name: string
  sign: string
  sign_num: number
  position: number
  abs_position: number
}

export interface Aspect {
  p1_name: string
  p2_name: string
  aspect: string
  orbit: number
  aspect_degrees: number
  diff: number
}

export interface LunarPhase {
  degrees_between_sun_moon?: number | null
  moon_phase?: number | null
  sun_phase?: number | null
  moon_phase_name?: string | null
}

export interface NatalChart {
  name: string
  birth_datetime_utc: string
  birth_datetime_local: string
  timezone: string
  latitude: number
  longitude: number
  zodiac_type: string
  houses_system: string
  planets: CelestialPoint[]
  axes: CelestialPoint[]
  houses: House[]
  aspects: Aspect[]
  lunar_phase: LunarPhase
}
