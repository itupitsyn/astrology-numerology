/**
 * Letter → digit tables for Pythagorean-style numerology.
 *
 * Two alphabets are supported because the app targets Russian-speaking users
 * whose names are Cyrillic, but Latin names must also work.
 */

// Latin Pythagorean table (1-9).
const LATIN_ROWS: Record<number, string> = {
  1: 'ajs',
  2: 'bkt',
  3: 'clu',
  4: 'dmv',
  5: 'enw',
  6: 'fox',
  7: 'gpy',
  8: 'hqz',
  9: 'ir',
}

// Cyrillic table (1-9), common Russian numerology mapping.
const CYRILLIC_ROWS: Record<number, string> = {
  1: 'аисъ',
  2: 'бйты',
  3: 'вкуь',
  4: 'глфэ',
  5: 'дмхю',
  6: 'енця',
  7: 'ёоч',
  8: 'жпш',
  9: 'зрщ',
}

function buildLetterValues(rows: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [value, letters] of Object.entries(rows)) {
    for (const ch of letters) out[ch] = Number(value)
  }
  return out
}

/** Combined map: lowercase letter → numeric value (both alphabets). */
export const LETTER_VALUES: Record<string, number> = {
  ...buildLetterValues(LATIN_ROWS),
  ...buildLetterValues(CYRILLIC_ROWS),
}

/** Vowels per alphabet (lowercase). `й` is treated as a consonant. */
export const VOWELS: ReadonlySet<string> = new Set([
  ...'aeiou', // Latin (y treated as consonant by default)
  ...'аеёиоуыэюя', // Cyrillic
])

const LATIN_LETTERS = /[a-z]/
const CYRILLIC_LETTERS = /[а-яё]/

export function isLetter(ch: string): boolean {
  return ch in LETTER_VALUES
}

export function isVowel(ch: string): boolean {
  return VOWELS.has(ch)
}

/** Detect which alphabet a name predominantly uses. */
export function detectAlphabet(name: string): 'latin' | 'cyrillic' | 'mixed' | 'none' {
  const lower = name.toLowerCase()
  const hasLatin = LATIN_LETTERS.test(lower)
  const hasCyrillic = CYRILLIC_LETTERS.test(lower)
  if (hasLatin && hasCyrillic) return 'mixed'
  if (hasLatin) return 'latin'
  if (hasCyrillic) return 'cyrillic'
  return 'none'
}
