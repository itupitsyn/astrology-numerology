/**
 * Numerology domain types.
 *
 * Pure data only — no HTTP / framework coupling. This module is server-only by
 * design (kept out of the client bundle so the algorithm isn't trivially read).
 */

export interface BirthDate {
  year: number
  month: number // 1-12
  day: number // 1-31
}

export interface NumerologyInput {
  birth: BirthDate
  /** Full name. Optional: name-derived numbers are omitted when absent. */
  fullName?: string
  /** Year to compute the Personal Year for. Defaults to the current year. */
  targetYear?: number
  /**
   * Calendar day to compute the Personal Month and Personal Day for.
   * Omit for a birth-chart reading; supply it for a daily forecast, where the
   * Personal Day is the numerological anchor of the day.
   *
   * When present, its year overrides `targetYear` — a Personal Day computed
   * from one year's cycle and another year's date would be meaningless.
   */
  targetDate?: BirthDate
}

/**
 * A computed number together with whether it is a master number (11/22/33),
 * which are conventionally left unreduced.
 */
export interface NumerologyNumber {
  value: number
  isMaster: boolean
}

export interface NumerologyResult {
  /** Core life direction, from the full birth date. */
  lifePath: NumerologyNumber
  /** From the day of birth alone. */
  birthday: NumerologyNumber
  /** Personal Year within the 9-year cycle (always 1-9). */
  personalYear: NumerologyNumber
  /** Personal Month (always 1-9). Present only when `targetDate` was supplied. */
  personalMonth?: NumerologyNumber
  /** Personal Day (always 1-9). Present only when `targetDate` was supplied. */
  personalDay?: NumerologyNumber

  // --- Name-derived (present only when `fullName` is provided) ---
  /** Expression / Destiny — from all letters of the name. */
  expression?: NumerologyNumber
  /** Soul Urge / Heart's Desire — from the vowels. */
  soulUrge?: NumerologyNumber
  /** Personality — from the consonants. */
  personality?: NumerologyNumber
  /** Maturity — life path combined with expression. */
  maturity?: NumerologyNumber

  meta: {
    targetYear: number
    /** The day the Personal Month/Day were computed for, as YYYY-MM-DD. */
    targetDate?: string
    /** Alphabet detected for the name, when a name was supplied. */
    nameAlphabet?: 'latin' | 'cyrillic' | 'mixed' | 'none'
  }
}
