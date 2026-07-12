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

// --- Horary chart (client-facing shape of astro-service HoraryChart) ---
export interface DignityInfo {
  planet: string
  domicile: boolean
  exaltation: boolean
  triplicity: boolean
  term: boolean
  face: boolean
  detriment: boolean
  fall: boolean
  peregrine: boolean
  score: number
}

export interface HoraryAspectHit {
  p1: string
  p2: string
  aspect: string
  orb: number
  applying: boolean
  days_to_perfect?: number | null
  degrees_to_perfect?: number | null
  perfects_before_sign_exit: boolean
  favorable: boolean
}

export interface MoonState {
  void_of_course: boolean
  via_combusta: boolean
  next_aspect?: HoraryAspectHit | null
  last_aspect?: HoraryAspectHit | null
}

export interface ReceptionInfo {
  p1_receives_p2: string[]
  p2_receives_p1: string[]
  mutual: boolean
}

export interface Significator {
  role: string
  house: number
  planet: string
  sign: string
  position: number
  abs_position: number
  house_of_planet?: number | null
  retrograde: boolean
  speed: number
  dignity: DignityInfo
}

export type HoraryVerdict = 'yes' | 'no' | 'qualified'

export interface HoraryJudgment {
  verdict: HoraryVerdict
  perfection_mode?: string | null
  timing_days?: number | null
  reasons: string[]
}

export interface RadicalityFlags {
  ascendant_too_early: boolean
  ascendant_too_late: boolean
  moon_void_of_course: boolean
  moon_via_combusta: boolean
  saturn_in_first_or_seventh: boolean
}

export interface HoraryChart {
  question: string
  quesited_house: number
  querent_house: number
  is_day_chart: boolean
  moment_utc: string
  moment_local: string
  timezone: string
  latitude: number
  longitude: number
  chart: NatalChart
  querent: Significator
  quesited: Significator
  moon: MoonState
  receptions: ReceptionInfo
  radicality: RadicalityFlags
  judgment: HoraryJudgment
}

/** SSE `meta` payload for the horary interpretation stream. */
export interface HoraryMeta {
  horary: HoraryChart
}

export interface HoraryRequest {
  question: string
  /** Friendly category id (preferred) — mapped to a house server-side. */
  category?: string
  /** Or an explicit quesited house (1..12). */
  quesitedHouse?: number
  /** Cast for the current moment at the location. */
  askNow?: boolean
  /** Explicit moment (used when askNow is false). */
  year?: number
  month?: number
  day?: number
  hour?: number
  minute?: number
  latitude: number
  longitude: number
  timezone?: string
  city?: string
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
