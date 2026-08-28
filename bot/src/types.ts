/**
 * TypeScript mirror of the `/api/bot/*` responses served by the Nuxt layer
 * (`web/server/utils/daily.ts` and `web/server/utils/astro/daily.ts`).
 * Keep in sync if those change.
 *
 * Mirrored rather than imported: the bot is built and deployed as its own
 * container with its own build context, and the source of truth on the other
 * side is server-only code. This follows the convention already used between
 * the Nuxt layer and astro-service.
 */

export type DailyStatus = 'pending' | 'ready' | 'failed'

/** 'today' = Moon..Mars; 'background' = Jupiter and beyond. */
export type TransitLayer = 'today' | 'background'

export interface Highlight {
  kind: 'natal_aspect' | 'sky_aspect' | 'event'
  layer: TransitLayer
  score: number
  /** The chart-level fact, e.g. "Луна в квадрате к натальному Плутону". */
  title: string
  detail: string
  /**
   * What it means for an ordinary day, in plain language. This is what gets
   * shown; `title` is the astrology behind it, which most readers do not want.
   * Null where no everyday reading applies, and then the title stands in.
   */
  meaning?: string | null
  time_local?: string | null
}

export interface VoidOfCourse {
  start_local: string
  end_local: string
  starts_before_day: boolean
  ends_after_day: boolean
}

export interface MoonToday {
  sign_ru: string
  phase_name: string
  illumination: number
  waxing: boolean
  natal_house: number | null
  void_of_course: VoidOfCourse[]
}

export interface DailyEvent {
  kind: 'ingress' | 'station' | 'moon_phase'
  time_local: string
  planet?: string | null
  to_sign?: string | null
  retrograde?: boolean | null
  phase?: string | null
}

/**
 * How today looks for one area of life, out of ten.
 *
 * A summary rolled up from the same findings as the highlights — deterministic
 * and traceable, but not a measurement. One point of difference is noise, which
 * is why `label` exists and gets shown alongside the number.
 */
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
  houses_known: boolean
  moon: MoonToday
  retrogrades: string[]
  events: DailyEvent[]
  highlights: Highlight[]
  areas: AreaScore[]
}

export interface NumerologyNumber {
  value: number
  isMaster: boolean
}

export interface NumerologyResult {
  personalDay?: NumerologyNumber
  personalMonth?: NumerologyNumber
  personalYear: NumerologyNumber
}

export interface DailyResponse {
  /** Null for a facts-only answer that was never persisted — nothing to rate. */
  id: string | null
  status: DailyStatus
  date: string
  timezone: string
  forecast: DailyForecast | null
  numerology: NumerologyResult | null
  text: string | null
  model: string | null
  promptVersion: string | null
  error: string | null
}
