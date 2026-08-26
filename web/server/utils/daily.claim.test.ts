/**
 * Slot-claiming against a real Postgres.
 *
 * These cases exist because the property under test *is* a race: two requests
 * arriving at the same instant must not both start a generation on the single
 * GPU. A mocked database cannot reproduce that — the guarantee comes from a
 * unique index and from `UPDATE ... WHERE` being atomic, so it has to be
 * exercised against the real thing.
 *
 * Skipped unless TEST_DATABASE_URL points at a migrated database:
 *
 *   docker compose up -d postgres
 *   NUXT_DATABASE_URL=postgres://astro:astro@localhost:5433/astro bun run db:migrate
 *   TEST_DATABASE_URL=postgres://astro:astro@localhost:5433/astro bun run test
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../db/schema'
import { profiles, dailyReadings, type Profile } from '../db/schema'
import type { DailyForecast } from './astro/daily'
import {
  claimDailySlot,
  failDailyReading,
  finishDailyReading,
  getDailyReading,
  STALE_PENDING_MS,
} from './daily'
import type { NumerologyResult } from './numerology/types'

const url = process.env.TEST_DATABASE_URL
const describeDb = url ? describe : describe.skip

const client = url ? postgres(url, { max: 10 }) : null
const db = client ? drizzle(client, { schema }) : (null as never)

afterAll(async () => {
  await client?.end({ timeout: 5 })
})

const LOCAL_DATE = '2026-08-25'
const TZ = 'Europe/Moscow'

// Minimal stand-ins: claiming never inspects the payloads, it only stores them.
const forecast = { date: LOCAL_DATE, timezone: TZ } as unknown as DailyForecast
const numerology = { personalDay: { value: 9, isMaster: false } } as unknown as NumerologyResult

let profile: Profile

async function makeProfile(version = 'v1'): Promise<Profile> {
  const telegramId = Math.floor(Math.random() * 1e12)
  const [row] = await db
    .insert(profiles)
    .values({
      id: `p_${telegramId}`,
      telegramId,
      birthYear: 1990, birthMonth: 5, birthDay: 15, birthHour: 14, birthMinute: 30,
      birthLatitude: 55.7558, birthLongitude: 37.6173,
      birthTimezone: TZ,
      placeTimezone: TZ,
      version,
    })
    .returning()
  return row!
}

const claim = () =>
  claimDailySlot({ profile, localDate: LOCAL_DATE, timezone: TZ, forecast, numerology }, db)

describeDb('claimDailySlot', () => {
  beforeEach(async () => {
    profile = await makeProfile()
  })

  it('gives the slot to the first caller', async () => {
    const result = await claim()
    expect(result.claimed).toBe(true)
    expect(result.row.status).toBe('pending')
    expect(result.row.profileVersion).toBe(profile.version)
  })

  it('grants exactly one claim to eight simultaneous callers', async () => {
    // The headline guarantee: one tap or eight, one generation.
    const results = await Promise.all(Array.from({ length: 8 }, claim))
    expect(results.filter((r) => r.claimed)).toHaveLength(1)

    // And everyone gets the same row back, so every caller can answer at once.
    const ids = new Set(results.map((r) => r.row.id))
    expect(ids.size).toBe(1)
  })

  it('does not re-claim a slot that is still being generated', async () => {
    await claim()
    const second = await claim()
    expect(second.claimed).toBe(false)
    expect(second.row.status).toBe('pending')
  })

  it('does not re-claim a finished reading', async () => {
    const first = await claim()
    await finishDailyReading(
      first.row.id,
      { interpretation: 'готовый текст', promptVersion: 'daily-v1', model: 'test' },
      db,
    )

    const second = await claim()
    expect(second.claimed).toBe(false)
    expect(second.row.status).toBe('ready')
    expect(second.row.interpretation).toBe('готовый текст')
  })

  it('reclaims after a failed generation', async () => {
    const first = await claim()
    await failDailyReading(first.row.id, 'LLM exploded', db)

    const second = await claim()
    expect(second.claimed).toBe(true)
    expect(second.row.status).toBe('pending')
    // The failed attempt's error must not linger next to fresh facts.
    expect(second.row.error).toBeNull()
  })

  it('reclaims a slot abandoned by a restart', async () => {
    const first = await claim()
    // Backdate the claim past the staleness window, as a dead process would.
    await db
      .update(dailyReadings)
      .set({ claimedAt: new Date(Date.now() - STALE_PENDING_MS - 1000) })
      .where(eq(dailyReadings.id, first.row.id))

    const second = await claim()
    expect(second.claimed).toBe(true)
    expect(second.row.id).toBe(first.row.id) // same row, new attempt
  })

  it('grants exactly one reclaim of a stale slot to concurrent callers', async () => {
    const first = await claim()
    await db
      .update(dailyReadings)
      .set({ claimedAt: new Date(Date.now() - STALE_PENDING_MS - 1000) })
      .where(eq(dailyReadings.id, first.row.id))

    const results = await Promise.all(Array.from({ length: 6 }, claim))
    expect(results.filter((r) => r.claimed)).toHaveLength(1)
  })

  it('reclaims when the profile changed underneath a finished reading', async () => {
    const first = await claim()
    await finishDailyReading(
      first.row.id,
      { interpretation: 'старый текст', promptVersion: 'daily-v1' },
      db,
    )

    // The user moved city: same day, different sky.
    profile = { ...profile, version: 'v2' }
    const second = await claim()
    expect(second.claimed).toBe(true)
    expect(second.row.profileVersion).toBe('v2')
    // Stale prose must never be served alongside recomputed facts.
    expect(second.row.interpretation).toBeNull()
  })

  it('keeps separate slots per day and per profile', async () => {
    await claim()

    const otherDay = await claimDailySlot(
      { profile, localDate: '2026-08-26', timezone: TZ, forecast, numerology },
      db,
    )
    expect(otherDay.claimed).toBe(true)

    const otherProfile = await makeProfile()
    const theirs = await claimDailySlot(
      { profile: otherProfile, localDate: LOCAL_DATE, timezone: TZ, forecast, numerology },
      db,
    )
    expect(theirs.claimed).toBe(true)
  })

  it('stores the facts so a pending row can already be answered with', async () => {
    const { row } = await claim()
    const fetched = await getDailyReading(profile.id, LOCAL_DATE, db)
    expect(fetched?.id).toBe(row.id)
    expect(fetched?.forecast).toMatchObject({ date: LOCAL_DATE })
    expect(fetched?.numerology).toMatchObject({ personalDay: { value: 9 } })
    expect(fetched?.interpretation).toBeNull()
  })
})
