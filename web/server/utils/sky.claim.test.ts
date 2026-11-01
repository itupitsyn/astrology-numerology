/**
 * Slot-claiming against a real Postgres, for the same reason as
 * `daily.claim.test.ts`: the property under test is a race. Skipped unless
 * TEST_DATABASE_URL points at a migrated database.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import * as schema from '../db/schema'
import { skyReadings } from '../db/schema'
import type { SkyForecast } from './astro/daily'
import { STALE_NOTE_MS } from './dailyNote'
import { claimSkySlot } from './sky'

const url = process.env.TEST_DATABASE_URL
const describeDb = url ? describe : describe.skip

const client = url ? postgres(url, { max: 10 }) : null
const db = client ? drizzle(client, { schema }) : (null as never)

afterAll(async () => {
  await client?.end({ timeout: 5 })
})

const forecast = {} as unknown as SkyForecast

/** A timezone nobody else uses keeps each case on its own row. */
const input = () => ({ localDate: '2026-11-01', timezone: `Test/${nanoid(8)}`, forecast })

describeDb('claimSkySlot', () => {
  it('lets exactly one of many concurrent requests start the note', async () => {
    const key = input()
    const results = await Promise.all(Array.from({ length: 10 }, () => claimSkySlot(key, db)))
    expect(results.filter((r) => r.claimed)).toHaveLength(1)
    expect(new Set(results.map((r) => r.row.id)).size).toBe(1)
  })

  it('does not take over a note already sent', async () => {
    const key = input()
    const { row } = await claimSkySlot(key, db)
    await db.update(skyReadings).set({ status: 'ready', fileId: 'file-1' }).where(eq(skyReadings.id, row.id))
    const again = await claimSkySlot(key, db)
    expect(again.claimed).toBe(false)
    expect(again.row.fileId).toBe('file-1')
  })

  it('takes over a failed attempt and an abandoned one, but not a live one', async () => {
    const key = input()
    const { row } = await claimSkySlot(key, db)
    expect((await claimSkySlot(key, db)).claimed).toBe(false)

    await db.update(skyReadings).set({ status: 'failed' }).where(eq(skyReadings.id, row.id))
    expect((await claimSkySlot(key, db)).claimed).toBe(true)

    const longAgo = new Date(Date.now() - STALE_NOTE_MS - 1_000)
    await db.update(skyReadings).set({ claimedAt: longAgo }).where(eq(skyReadings.id, row.id))
    expect((await claimSkySlot(key, db)).claimed).toBe(true)
  })
})
