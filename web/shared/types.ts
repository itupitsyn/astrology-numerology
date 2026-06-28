/**
 * Client-facing API contracts (shared between app and server).
 * These are display shapes only — the numerology algorithm itself stays in
 * server/utils and is never shipped to the client.
 */

// --- Geocoding ---
export interface GeoLocation {
  display_name: string
  latitude: number
  longitude: number
  timezone: string
  type?: string | null
}

export interface GeocodeResponse {
  query: string
  results: GeoLocation[]
}

// --- Natal chart ---
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
  moon_phase_name?: string | null
}

export interface NatalChart {
  name: string
  birth_datetime_local: string
  timezone: string
  latitude: number
  longitude: number
  planets: CelestialPoint[]
  axes: CelestialPoint[]
  houses: House[]
  aspects: Aspect[]
  lunar_phase: LunarPhase
}

// --- Numerology ---
export interface NumerologyNumber {
  value: number
  isMaster: boolean
}

export interface NumerologyResult {
  lifePath: NumerologyNumber
  birthday: NumerologyNumber
  personalYear: NumerologyNumber
  expression?: NumerologyNumber
  soulUrge?: NumerologyNumber
  personality?: NumerologyNumber
  maturity?: NumerologyNumber
  meta: { targetYear: number; nameAlphabet?: string }
}

// --- Interpretation stream ---
export interface InterpretationMeta {
  chart: NatalChart
  numerology: NumerologyResult
}

export interface InterpretationRequest {
  fullName?: string
  name?: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  latitude: number
  longitude: number
  timezone?: string
  city?: string
  targetYear?: number
  focus?: string
}
