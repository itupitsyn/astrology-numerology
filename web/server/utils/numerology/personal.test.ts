import { describe, expect, it } from 'vitest'
import { computeNumerology, personalDayNumber, personalMonthNumber, personalYearNumber } from './core'

const birth = { year: 1990, month: 5, day: 15 }

describe('personal cycles', () => {
  // Personal Year = reduce(month) + reduce(day) + reduce(year), then reduce.
  // 5 + 6 + 1 (2026 -> 10 -> 1) = 12 -> 3
  it('personal year for 2026', () => {
    expect(personalYearNumber(birth, 2026).value).toBe(3)
  })

  // Personal Month = personal year + month. August: 3 + 8 = 11 -> 2.
  it('personal month adds the calendar month to the personal year', () => {
    expect(personalMonthNumber(birth, 2026, 8).value).toBe(2)
  })

  // Personal Day = personal month + day. 25th: 2 + 7 (25 -> 7) = 9.
  it('personal day adds the calendar day to the personal month', () => {
    expect(personalDayNumber(birth, 2026, 8, 25).value).toBe(9)
  })

  it('cycle numbers never keep master numbers', () => {
    // A cycle is a position in a 9-step sequence, so 11/22/33 do not apply.
    for (let day = 1; day <= 31; day++) {
      for (let month = 1; month <= 12; month++) {
        const value = personalDayNumber(birth, 2026, month, day).value
        expect(value).toBeGreaterThanOrEqual(1)
        expect(value).toBeLessThanOrEqual(9)
      }
    }
  })

  it('personal day advances by one from day to day', () => {
    // Within a month the day number simply increments (mod 9), which is a cheap
    // sanity check that the reduction is not losing information.
    const first = personalDayNumber(birth, 2026, 8, 10).value
    const second = personalDayNumber(birth, 2026, 8, 11).value
    expect(second).toBe((first % 9) + 1)
  })
})

describe('computeNumerology with a target date', () => {
  it('omits personal month and day when no date is given', () => {
    const result = computeNumerology({ birth, targetYear: 2026 })
    expect(result.personalYear.value).toBe(3)
    expect(result.personalMonth).toBeUndefined()
    expect(result.personalDay).toBeUndefined()
    expect(result.meta.targetDate).toBeUndefined()
  })

  it('computes the whole cycle from a target date', () => {
    const result = computeNumerology({ birth, targetDate: { year: 2026, month: 8, day: 25 } })
    expect(result.personalYear.value).toBe(3)
    expect(result.personalMonth?.value).toBe(2)
    expect(result.personalDay?.value).toBe(9)
    expect(result.meta.targetDate).toBe('2026-08-25')
    expect(result.meta.targetYear).toBe(2026)
  })

  it('targetDate wins over a conflicting targetYear', () => {
    // A Personal Day belongs to its own year's cycle; mixing the two would
    // produce a number that means nothing.
    const result = computeNumerology({
      birth,
      targetYear: 2020,
      targetDate: { year: 2026, month: 8, day: 25 },
    })
    expect(result.meta.targetYear).toBe(2026)
    expect(result.personalYear.value).toBe(personalYearNumber(birth, 2026).value)
  })

  it('rejects a malformed target date', () => {
    expect(() =>
      computeNumerology({ birth, targetDate: { year: 2026, month: 13, day: 1 } }),
    ).toThrow(RangeError)
  })

  it('still computes name numbers alongside the daily cycle', () => {
    const result = computeNumerology({
      birth,
      fullName: 'Иван Петров',
      targetDate: { year: 2026, month: 8, day: 25 },
    })
    expect(result.expression).toBeDefined()
    expect(result.personalDay?.value).toBe(9)
  })
})
