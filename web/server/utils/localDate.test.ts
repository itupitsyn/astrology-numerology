import { describe, expect, it } from 'vitest'
import { isValidTimezone, localDateIn, localHourIn, parseLocalDate } from './localDate'

describe('localDateIn', () => {
  it('formats as YYYY-MM-DD', () => {
    const at = new Date('2026-08-25T09:00:00Z')
    expect(localDateIn('Europe/Moscow', at)).toBe('2026-08-25')
  })

  it('is the local day, not the server day', () => {
    // 22:30 UTC is already the 26th in Vladivostok (+10) and still the 25th in
    // Lisbon (+1). This is the whole reason the forecast is keyed on a local
    // date rather than a UTC one.
    const at = new Date('2026-08-25T22:30:00Z')
    expect(localDateIn('Asia/Vladivostok', at)).toBe('2026-08-26')
    expect(localDateIn('Europe/Lisbon', at)).toBe('2026-08-25')
    expect(localDateIn('UTC', at)).toBe('2026-08-25')
  })

  it('handles the far side of midnight westward', () => {
    const at = new Date('2026-08-25T02:00:00Z')
    expect(localDateIn('America/Los_Angeles', at)).toBe('2026-08-24')
  })
})

describe('localHourIn', () => {
  it('returns the local wall-clock hour', () => {
    const at = new Date('2026-08-25T09:00:00Z')
    expect(localHourIn('Europe/Moscow', at)).toBe(12) // UTC+3
    expect(localHourIn('UTC', at)).toBe(9)
  })

  it('reports midnight as 0, never 24', () => {
    const at = new Date('2026-08-25T21:00:00Z') // 00:00 in Moscow
    expect(localHourIn('Europe/Moscow', at)).toBe(0)
  })
})

describe('isValidTimezone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimezone('Europe/Moscow')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
  })

  it('rejects nonsense', () => {
    expect(isValidTimezone('Middle/Earth')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone('MSK+3')).toBe(false)
  })
})

describe('parseLocalDate', () => {
  it('splits a well-formed date', () => {
    expect(parseLocalDate('2026-08-25')).toEqual({ year: 2026, month: 8, day: 25 })
  })

  it('rejects anything else', () => {
    expect(() => parseLocalDate('2026-8-5')).toThrow(RangeError)
    expect(() => parseLocalDate('25.08.2026')).toThrow(RangeError)
    expect(() => parseLocalDate('')).toThrow(RangeError)
  })
})
