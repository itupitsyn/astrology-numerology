/**
 * The general forecast (/sky): Mika tells how the day looks for everybody.
 *
 * The same steps as a personal note (see `dailyNote.ts`): a script from the LLM,
 * a render in the GPU queue, an upload by the bot. The difference is the key: one
 * row per day and timezone, so every chat that asks shares one render and gets
 * the video by Telegram's file_id.
 */

import { and, eq, lt, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { H3Event } from 'h3'
import { FetchError } from 'ofetch'
import { skyReadings, type SkyReading } from '../db/schema'
import type { SkyForecast } from './astro/daily'
import { fetchResult, notesApi, STALE_NOTE_MS, type NoteResponse } from './dailyNote'
import { useDb, type Database } from './db'
import { chatCompletion } from './llm/client'
import { LlmBusyError, withLlmSlot } from './llm/limiter'
import { cleanNoteScript } from './llm/notePrompt'
import { buildSkyPrompt, SKY_PROMPT_VERSION } from './llm/skyPrompt'

/** The one clock for now. A timezone per chat would need a setting to store it in. */
export const SKY_TIMEZONE = 'Europe/Moscow'

export interface SkyResponse extends NoteResponse {
  id: string
}

export function toSkyResponse(row: SkyReading): SkyResponse {
  if (row.status === 'ready' && row.fileId) {
    return { id: row.id, status: 'ready', fileId: row.fileId, error: null }
  }
  return {
    id: row.id,
    status: row.status === 'failed' ? 'failed' : 'pending',
    fileId: null,
    error: row.error ?? null,
  }
}

export async function getSkyReading(
  localDate: string,
  timezone: string,
  db: Database = useDb(),
): Promise<SkyReading | undefined> {
  return db.query.skyReadings.findFirst({
    where: and(eq(skyReadings.localDate, localDate), eq(skyReadings.timezone, timezone)),
  })
}

export async function getSkyReadingById(id: string): Promise<SkyReading | undefined> {
  return useDb().query.skyReadings.findFirst({ where: eq(skyReadings.id, id) })
}

/**
 * Take the slot for the day, or report who holds it. The insert is the first
 * claim, and an UPDATE whose WHERE decides takes over a failed or abandoned one.
 */
export async function claimSkySlot(
  input: { localDate: string; timezone: string; forecast: SkyForecast },
  db: Database = useDb(),
): Promise<{ row: SkyReading; claimed: boolean }> {
  const { localDate, timezone, forecast } = input
  const fresh = {
    status: 'pending',
    claimedAt: new Date(),
    forecast,
    script: null,
    job: null,
    fileId: null,
    error: null,
    promptVersion: SKY_PROMPT_VERSION,
  }

  const [inserted] = await db
    .insert(skyReadings)
    .values({ id: nanoid(12), localDate, timezone, ...fresh })
    .onConflictDoNothing({ target: [skyReadings.localDate, skyReadings.timezone] })
    .returning()
  if (inserted) return { row: inserted, claimed: true }

  const staleBefore = new Date(Date.now() - STALE_NOTE_MS)
  const [reclaimed] = await db
    .update(skyReadings)
    .set(fresh)
    .where(
      and(
        eq(skyReadings.localDate, localDate),
        eq(skyReadings.timezone, timezone),
        or(
          eq(skyReadings.status, 'failed'),
          and(eq(skyReadings.status, 'pending'), lt(skyReadings.claimedAt, staleBefore)),
        ),
      ),
    )
    .returning()
  if (reclaimed) return { row: reclaimed, claimed: true }

  const current = await getSkyReading(localDate, timezone, db)
  if (current) return { row: current, claimed: false }
  return claimSkySlot(input, db)  // deleted between the two statements
}

async function failSky(id: string, message: string): Promise<void> {
  await useDb()
    .update(skyReadings)
    .set({ status: 'failed', error: message.slice(0, 500) })
    .where(eq(skyReadings.id, id))
}

/** Write the script and queue the render. Detached; never throws: the row records what happened. */
export async function produceSky(event: H3Event, row: SkyReading): Promise<void> {
  try {
    const api = notesApi(event)
    const llm = await withLlmSlot(() =>
      chatCompletion(event, buildSkyPrompt(row.forecast), { temperature: 0.7 }),
    )
    const script = cleanNoteScript(llm.content ?? '')
    if (script.replace(/\[[a-z]+\]/g, '').trim().length < 40) {
      throw new Error('LLM returned an empty script')
    }
    await useDb().update(skyReadings).set({ script }).where(eq(skyReadings.id, row.id))

    const job = await $fetch<{ id: string }>('/api/video-note', {
      ...api,
      method: 'POST',
      body: { script },
      timeout: 30_000,
    })
    await useDb().update(skyReadings).set({ job: job.id }).where(eq(skyReadings.id, row.id))
  } catch (err) {
    const message =
      err instanceof LlmBusyError
        ? 'LLM is busy — the note will be retried on the next request'
        : err instanceof FetchError
          ? `generation API: ${err.statusCode ?? 'unreachable'}`
          : err instanceof Error
            ? err.message
            : String(err)
    await failSky(row.id, message).catch(() => {})
  }
}

/** Where the note stands, asking the generation API while it renders. */
export async function checkSky(event: H3Event, row: SkyReading): Promise<SkyResponse> {
  if (row.status !== 'pending' || !row.job) return toSkyResponse(row)
  const result = await fetchResult(event, row.job)
  const failure = result === null ? 'the generation API lost the job' : result.status === 'error' ? String(result.data ?? 'render failed') : null
  if (failure) {
    await failSky(row.id, failure)
    return { id: row.id, status: 'failed', fileId: null, error: failure }
  }
  return { id: row.id, status: result?.status === 'done' ? 'rendered' : 'pending', fileId: null, error: null }
}

export async function skyVideo(event: H3Event, row: SkyReading): Promise<Buffer | null> {
  if (!row.job) return null
  const result = await fetchResult(event, row.job)
  if (result?.status !== 'done' || !result.data) return null
  return Buffer.from(result.data, 'base64')
}

/** The bot uploaded it: from now on every chat gets Telegram's file_id. */
export async function markSkySent(id: string, fileId: string): Promise<void> {
  await useDb().update(skyReadings).set({ status: 'ready', fileId, error: null }).where(eq(skyReadings.id, id))
}
