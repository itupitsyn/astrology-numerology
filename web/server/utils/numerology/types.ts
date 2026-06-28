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
    /** Alphabet detected for the name, when a name was supplied. */
    nameAlphabet?: 'latin' | 'cyrillic' | 'mixed' | 'none'
  }
}
