/**
 * TypeScript mirror of the daily-transit schemas in astro-service/models.py.
 * Keep in sync if the Python models change.
 *
 * Split out of `types.ts` because the daily forecast is a self-contained
 * contract: it shares no shapes with the natal or horary endpoints.
 */

import type { BirthData } from './types'

/** Where the person is *now* — not where they were born. */
export interface PlaceRef {
  latitude: number
  longitude: number
  timezone?: string | null
  city?: string | null
}

export interface DailyRequest {
  birth: BirthData
  /** Current location; drives the day boundary and local event times. */
  place?: PlaceRef
  /** Local calendar date (YYYY-MM-DD). Omit for "today at `place`". */
  date?: string
  reference_hour?: number
  reference_minute?: number
  max_highlights?: number
  /**
   * False when the birth time is unknown. Houses and the angles sweep the whole
   * zodiac every 24 hours, so without a birth time they are meaningless rather
   * than imprecise — they are omitted instead of computed from a placeholder.
   */
  houses_known?: boolean
}

/** 'today' = Moon..Mars; 'background' = Jupiter and beyond. */
export type TransitLayer = 'today' | 'background'

export interface TransitPosition {
  planet: string
  sign: string
  sign_num: number
  sign_ru: string
  position: number
  abs_position: number
  retrograde: boolean
  speed: number
  /**
   * The *natal* house this transiting body currently falls in.
   * Null when the birth time is unknown.
   */
  natal_house: number | null
}

export interface DailyAspect {
  transit: string
  /** Natal point aspected (transit->natal only). */
  natal?: string | null
  /** Other transiting body (sky aspects only). */
  other?: string | null
  aspect: string
  orb: number
  applying: boolean
  favorable: boolean
  retrograde?: boolean
  layer: TransitLayer
  /** Local time the aspect perfects, if it does so today. */
  exact_local?: string | null
  score: number
}

export interface DailyEvent {
  kind: 'ingress' | 'station' | 'moon_phase'
  time_local: string
  planet?: string | null
  from_sign?: string | null
  to_sign?: string | null
  retrograde?: boolean | null
  phase?: string | null
  sign?: string | null
}

export interface VoidOfCourse {
  start_local: string
  end_local: string
  starts_before_day: boolean
  ends_after_day: boolean
}

export interface MoonToday {
  sign: string
  sign_num: number
  sign_ru: string
  position: number
  abs_position: number
  phase_angle: number
  phase_name: string
  illumination: number
  waxing: boolean
  sign_at_day_start: string
  sign_at_day_end: string
  /** Null when the birth time is unknown. */
  natal_house: number | null
  speed: number
  void_of_course: VoidOfCourse[]
}

/**
 * One ranked thing worth saying about the day, already phrased in Russian.
 * This is what a bot can send instantly, before any LLM has run.
 */
export interface Highlight {
  kind: 'natal_aspect' | 'sky_aspect' | 'event'
  layer: TransitLayer
  score: number
  /** The chart-level fact, e.g. "Луна в квадрате к натальному Плутону". */
  title: string
  detail: string
  /**
   * What it means for an ordinary day, in plain language — the part a reader
   * actually wants, phrased as a tendency rather than an event that will happen.
   * Null where no everyday reading applies.
   */
  meaning?: string | null
  time_local?: string | null
  data: Record<string, unknown>
}

/** How today looks for one area of life, out of ten. A rolled-up summary of the
 *  same findings as `highlights` — deterministic and traceable, not a measurement. */
export interface AreaScore {
  id: 'career' | 'work' | 'money' | 'love' | 'family' | 'health' | 'mind'
  title: string
  emoji: string
  score: number
  label: string
  /** Nothing in today's chart touches this area; the score is the neutral value. */
  quiet: boolean
  drivers: string[]
}

export interface DailyForecast {
  date: string
  timezone: string
  latitude: number
  longitude: number
  reference_local: string
  reference_utc: string
  /** False when the birth time was unknown: no houses, no Ascendant/MC. */
  houses_known: boolean
  moon: MoonToday
  positions: TransitPosition[]
  retrogrades: string[]
  areas: AreaScore[]
  natal_aspects: DailyAspect[]
  sky_aspects: DailyAspect[]
  events: DailyEvent[]
  highlights: Highlight[]
}
