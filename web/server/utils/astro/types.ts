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

// --- Horary chart (mirror of astro-service models.py HoraryChart) ---
export interface HoraryQuestion {
  question: string
  quesited_house: number
  querent_house?: number
  ask_now?: boolean
  year?: number | null
  month?: number | null
  day?: number | null
  hour?: number | null
  minute?: number | null
  latitude: number
  longitude: number
  timezone?: string | null
  city?: string | null
}

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

export interface AspectHit {
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
  next_aspect?: AspectHit | null
  last_aspect?: AspectHit | null
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
