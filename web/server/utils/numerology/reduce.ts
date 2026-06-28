/**
 * Numeric reduction — the heart of numerology arithmetic.
 */

import type { NumerologyNumber } from './types'

export const MASTER_NUMBERS = [11, 22, 33] as const

export function isMasterNumber(n: number): boolean {
  return (MASTER_NUMBERS as readonly number[]).includes(n)
}

/** Sum of the decimal digits of |n|. */
export function digitSum(n: number): number {
  let v = Math.abs(Math.trunc(n))
  let sum = 0
  while (v > 0) {
    sum += v % 10
    v = Math.floor(v / 10)
  }
  return sum
}

/**
 * Repeatedly sum digits until a single digit is reached.
 *
 * When `keepMaster` is true (default), reduction halts on a master number
 * (11/22/33) instead of collapsing it to a single digit.
 */
export function reduce(n: number, keepMaster = true): number {
  let v = Math.abs(Math.trunc(n))
  while (v > 9 && !(keepMaster && isMasterNumber(v))) {
    v = digitSum(v)
  }
  return v
}

/** Reduce and wrap the result with its master-number flag. */
export function toNumber(n: number, keepMaster = true): NumerologyNumber {
  const value = reduce(n, keepMaster)
  return { value, isMaster: isMasterNumber(value) }
}
