import { describe, expect, it } from 'vitest'
import { digitSum, reduce } from './reduce'
import {
  birthdayNumber,
  computeNumerology,
  expressionNumber,
  lifePathNumber,
  personalityNumber,
  personalYearNumber,
  soulUrgeNumber,
} from './core'

describe('reduce', () => {
  it('sums digits', () => {
    expect(digitSum(1990)).toBe(19)
    expect(digitSum(38)).toBe(11)
  })

  it('reduces to a single digit', () => {
    expect(reduce(12)).toBe(3)
    expect(reduce(1990)).toBe(1) // 19 -> 10 -> 1
  })

  it('preserves master numbers by default', () => {
    expect(reduce(38)).toBe(11) // 3+8 = 11, stop
    expect(reduce(29)).toBe(11) // 2+9 = 11
    expect(reduce(11)).toBe(11)
    expect(reduce(22)).toBe(22)
  })

  it('collapses master numbers when keepMaster is false', () => {
    expect(reduce(11, false)).toBe(2)
    expect(reduce(38, false)).toBe(2)
  })
})

describe('date numbers (1990-05-15)', () => {
  const birth = { year: 1990, month: 5, day: 15 }

  it('life path', () => {
    // month 5 + day(15->6) + year(1990->1) = 12 -> 3
    expect(lifePathNumber(birth)).toEqual({ value: 3, isMaster: false })
  })

  it('birthday', () => {
    expect(birthdayNumber(birth)).toEqual({ value: 6, isMaster: false })
  })

  it('personal year 2026 (master collapsed)', () => {
    // 5 + 6 + (2026->1) = 12 -> 3
    expect(personalYearNumber(birth, 2026)).toEqual({ value: 3, isMaster: false })
  })
})

describe('name numbers — Latin (John)', () => {
  it('expression / soul urge / personality', () => {
    // J1 O6 H8 N5 = 20 -> 2
    expect(expressionNumber('John')).toEqual({ value: 2, isMaster: false })
    // vowels: O6 -> 6
    expect(soulUrgeNumber('John')).toEqual({ value: 6, isMaster: false })
    // consonants: J1 H8 N5 = 14 -> 5
    expect(personalityNumber('John')).toEqual({ value: 5, isMaster: false })
  })
})

describe('name numbers — Cyrillic (Иван)', () => {
  it('yields a master expression number', () => {
    // и1 в3 а1 н6 = 11 (master)
    expect(expressionNumber('Иван')).toEqual({ value: 11, isMaster: true })
    // vowels: и1 а1 = 2
    expect(soulUrgeNumber('Иван')).toEqual({ value: 2, isMaster: false })
    // consonants: в3 н6 = 9
    expect(personalityNumber('Иван')).toEqual({ value: 9, isMaster: false })
  })
})

describe('computeNumerology', () => {
  it('omits name-derived numbers when no name is given', () => {
    const r = computeNumerology({ birth: { year: 1990, month: 5, day: 15 }, targetYear: 2026 })
    expect(r.lifePath.value).toBe(3)
    expect(r.expression).toBeUndefined()
    expect(r.meta.nameAlphabet).toBe('none')
  })

  it('includes name-derived numbers and detects the alphabet', () => {
    const r = computeNumerology({
      birth: { year: 1990, month: 5, day: 15 },
      fullName: 'Иван',
      targetYear: 2026,
    })
    expect(r.expression?.value).toBe(11)
    expect(r.maturity).toBeDefined()
    expect(r.meta.nameAlphabet).toBe('cyrillic')
  })

  it('rejects an invalid date', () => {
    expect(() => computeNumerology({ birth: { year: 1990, month: 13, day: 15 } })).toThrow()
  })
})
