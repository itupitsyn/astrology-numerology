/**
 * Numerology calculators and the top-level `computeNumerology` entry point.
 *
 * Conventions used here (there are competing schools; these are the choices
 * this app commits to):
 *  - Life Path: reduce month, day and year separately (keeping master numbers),
 *    then add and reduce again. Preserves master numbers better than summing all
 *    digits at once.
 *  - Master numbers 11/22/33 are preserved for life path, birthday and the
 *    name-derived numbers; Personal Year is always reduced to 1-9 (it is a
 *    9-year cycle).
 */

import { detectAlphabet, isLetter, isVowel, LETTER_VALUES } from './maps'
import { reduce, toNumber } from './reduce'
import type {
  BirthDate,
  NumerologyInput,
  NumerologyNumber,
  NumerologyResult,
} from './types'

type LetterFilter = 'all' | 'vowels' | 'consonants'

/** Sum the numeric values of a name's letters, filtered by kind. */
function nameValue(name: string, filter: LetterFilter): number {
  let sum = 0
  for (const ch of name.toLowerCase()) {
    if (!isLetter(ch)) continue
    if (filter === 'vowels' && !isVowel(ch)) continue
    if (filter === 'consonants' && isVowel(ch)) continue
    sum += LETTER_VALUES[ch] ?? 0
  }
  return sum
}

export function lifePathNumber(birth: BirthDate): NumerologyNumber {
  const parts = reduce(birth.month) + reduce(birth.day) + reduce(birth.year)
  return toNumber(parts)
}

export function birthdayNumber(birth: BirthDate): NumerologyNumber {
  return toNumber(birth.day)
}

export function expressionNumber(fullName: string): NumerologyNumber {
  return toNumber(nameValue(fullName, 'all'))
}

export function soulUrgeNumber(fullName: string): NumerologyNumber {
  return toNumber(nameValue(fullName, 'vowels'))
}

export function personalityNumber(fullName: string): NumerologyNumber {
  return toNumber(nameValue(fullName, 'consonants'))
}

export function maturityNumber(lifePath: number, expression: number): NumerologyNumber {
  return toNumber(lifePath + expression)
}

/** Personal Year for a given calendar year. Always reduced to 1-9. */
export function personalYearNumber(birth: BirthDate, targetYear: number): NumerologyNumber {
  const sum = reduce(birth.month) + reduce(birth.day) + reduce(targetYear)
  return toNumber(sum, /* keepMaster */ false)
}

/**
 * Personal Month — the Personal Year carried into one calendar month.
 * Always reduced to 1-9: like the year, it is a position in a 9-step cycle,
 * not a standalone number, so master numbers do not apply.
 */
export function personalMonthNumber(
  birth: BirthDate,
  targetYear: number,
  targetMonth: number,
): NumerologyNumber {
  const sum = personalYearNumber(birth, targetYear).value + reduce(targetMonth)
  return toNumber(sum, /* keepMaster */ false)
}

/**
 * Personal Day — the numerological anchor of a daily forecast. Always 1-9.
 */
export function personalDayNumber(
  birth: BirthDate,
  targetYear: number,
  targetMonth: number,
  targetDay: number,
): NumerologyNumber {
  const sum = personalMonthNumber(birth, targetYear, targetMonth).value + reduce(targetDay)
  return toNumber(sum, /* keepMaster */ false)
}

function validateBirth(birth: BirthDate): void {
  const { year, month, day } = birth
  if (!Number.isInteger(year) || year < 1 || year > 3000) {
    throw new RangeError(`Invalid birth year: ${year}`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid birth month: ${month}`)
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError(`Invalid birth day: ${day}`)
  }
}

export function computeNumerology(input: NumerologyInput): NumerologyResult {
  validateBirth(input.birth)

  // A Personal Day belongs to the cycle of its own year, so `targetDate` wins
  // over `targetYear` when both are given.
  const targetDate = input.targetDate
  if (targetDate) validateBirth(targetDate)

  const targetYear = targetDate?.year ?? input.targetYear ?? new Date().getUTCFullYear()
  if (!Number.isInteger(targetYear) || targetYear < 1 || targetYear > 3000) {
    throw new RangeError(`Invalid target year: ${targetYear}`)
  }

  const lifePath = lifePathNumber(input.birth)
  const birthday = birthdayNumber(input.birth)
  const personalYear = personalYearNumber(input.birth, targetYear)

  const result: NumerologyResult = {
    lifePath,
    birthday,
    personalYear,
    meta: { targetYear, nameAlphabet: 'none' },
  }

  if (targetDate) {
    result.personalMonth = personalMonthNumber(input.birth, targetYear, targetDate.month)
    result.personalDay = personalDayNumber(
      input.birth,
      targetYear,
      targetDate.month,
      targetDate.day,
    )
    const mm = String(targetDate.month).padStart(2, '0')
    const dd = String(targetDate.day).padStart(2, '0')
    result.meta.targetDate = `${targetDate.year}-${mm}-${dd}`
  }

  const name = input.fullName?.trim()
  if (name) {
    const expression = expressionNumber(name)
    result.expression = expression
    result.soulUrge = soulUrgeNumber(name)
    result.personality = personalityNumber(name)
    result.maturity = maturityNumber(lifePath.value, expression.value)
    result.meta.nameAlphabet = detectAlphabet(name)
  }

  return result
}
