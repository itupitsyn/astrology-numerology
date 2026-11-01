/**
 * Video notes: Mika reads the day's reading out loud, as a Telegram "кружок".
 *
 * Three costly steps, on two machines, so the flow mirrors the prose:
 *
 *  1. A short **script** — the finished prose retold as speech, by the same LLM.
 *  2. The **video** — voice, avatar and encoding, rendered by the generation API
 *     (ai-api-stuff, `POST /api/video-note`) in its GPU queue. It keeps the mp4
 *     under a job id; we keep only the id.
 *  3. The **send** — the bot uploads the mp4 once and hands back Telegram's
 *     `file_id`. Telegram keeps the file from then on, so a second tap resends
 *     it by id: no render, no upload, and no video stored here.
 *
 * The slot is claimed the same way as the prose: one UPDATE whose WHERE decides,
 * so a double tap cannot start two renders. A claim lost to a restart expires
 * after `STALE_NOTE_MS`.
 */

import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { FetchError } from 'ofetch'
import { dailyReadings, type DailyReading } from '../db/schema'
import { useDb, type Database } from './db'
import { chatCompletion } from './llm/client'
import { LlmBusyError, withLlmSlot } from './llm/limiter'
import { buildNotePrompt, cleanNoteScript } from './llm/notePrompt'

/** Script ~10 s, queue wait, render ~40–60 s — past this a pending claim is dead. */
export const STALE_NOTE_MS = 10 * 60_000

/**
 * What the bot sees.
 *  - 'pending'  — script or video still in the works; poll again
 *  - 'rendered' — the video is ready on the generation API; fetch and upload it
 *  - 'ready'    — sent before; resend by `fileId`
 *  - 'failed'   — tell the user; the next tap retries
 */
export type NoteStatus = 'pending' | 'rendered' | 'ready' | 'failed'

export interface NoteResponse {
  status: NoteStatus
  fileId: string | null
  error: string | null
}

export function toNoteResponse(row: DailyReading): NoteResponse {
  if (row.noteStatus === 'ready' && row.noteFileId) {
    return { status: 'ready', fileId: row.noteFileId, error: null }
  }
  return {
    status: row.noteStatus === 'failed' ? 'failed' : 'pending',
    fileId: null,
    error: row.noteError ?? null,
  }
}

export class NotesDisabledError extends Error {
  constructor() {
    super('video notes are not configured (NUXT_NOTES_API_URL)')
    this.name = 'NotesDisabledError'
  }
}

function notesApi(event: H3Event) {
  const { notes } = useRuntimeConfig(event)
  if (!notes?.apiUrl) throw new NotesDisabledError()
  const headers: Record<string, string> = {}
  if (notes.apiToken) headers['X-API-Token'] = String(notes.apiToken)
  return { baseURL: String(notes.apiUrl).replace(/\/+$/, ''), headers }
}

export function notesEnabled(event: H3Event): boolean {
  return !!useRuntimeConfig(event).notes?.apiUrl
}

/**
 * Take the note slot for a finished reading, or report who holds it.
 * Only a reading with its prose done can have a note — the script retells it.
 */
export async function claimNote(
  id: string,
  db: Database = useDb(),
): Promise<{ row: DailyReading | undefined; claimed: boolean }> {
  const staleBefore = new Date(Date.now() - STALE_NOTE_MS)
  const [claimed] = await db
    .update(dailyReadings)
    .set({
      noteStatus: 'pending',
      noteClaimedAt: new Date(),
      noteScript: null,
      noteJob: null,
      noteFileId: null,
      noteError: null,
    })
    .where(
      and(
        eq(dailyReadings.id, id),
        eq(dailyReadings.status, 'ready'),
        or(
          isNull(dailyReadings.noteStatus),
          eq(dailyReadings.noteStatus, 'failed'),
          and(eq(dailyReadings.noteStatus, 'pending'), lt(dailyReadings.noteClaimedAt, staleBefore)),
        ),
      ),
    )
    .returning()
  if (claimed) return { row: claimed, claimed: true }

  const row = await db.query.dailyReadings.findFirst({ where: eq(dailyReadings.id, id) })
  return { row, claimed: false }
}

async function failNote(id: string, message: string): Promise<void> {
  await useDb()
    .update(dailyReadings)
    .set({ noteStatus: 'failed', noteError: message.slice(0, 500) })
    .where(eq(dailyReadings.id, id))
}

/**
 * Write the script and queue the render. Detached from the request that
 * claimed the slot; never throws — the row records what happened.
 */
export async function produceNote(event: H3Event, row: DailyReading, name?: string | null): Promise<void> {
  try {
    if (!row.interpretation) throw new Error('reading has no prose to retell')
    const api = notesApi(event)

    const llm = await withLlmSlot(() =>
      chatCompletion(event, buildNotePrompt({ prose: row.interpretation!, localDate: row.localDate, name }), {
        temperature: 0.7,
      }),
    )
    const script = cleanNoteScript(llm.content ?? '')
    if (script.replace(/\[[a-z]+\]/g, '').trim().length < 40) {
      throw new Error('LLM returned an empty script')
    }
    await useDb().update(dailyReadings).set({ noteScript: script }).where(eq(dailyReadings.id, row.id))

    const job = await $fetch<{ id: string }>('/api/video-note', {
      ...api,
      method: 'POST',
      body: { script },
      timeout: 30_000,
    })
    await useDb().update(dailyReadings).set({ noteJob: job.id }).where(eq(dailyReadings.id, row.id))
  } catch (err) {
    const message =
      err instanceof LlmBusyError
        ? 'LLM is busy — the note will be retried on the next request'
        : err instanceof FetchError
          ? `generation API: ${err.statusCode ?? 'unreachable'} ${(err.data as { detail?: string })?.detail ?? ''}`.trim()
          : err instanceof Error
            ? err.message
            : String(err)
    await failNote(row.id, message).catch(() => {})
  }
}

type ApiResult = { status: 'pending' | 'in_progress' | 'done' | 'error'; data?: string }

async function fetchResult(event: H3Event, job: string): Promise<ApiResult | null> {
  try {
    return await $fetch<ApiResult>('/api/result', { ...notesApi(event), query: { id: job }, timeout: 60_000 })
  } catch (err) {
    // 404 — the API no longer knows the job (expired or lost to a restart).
    if (err instanceof FetchError && err.statusCode === 404) return null
    throw err
  }
}

/**
 * Where the note stands, asking the generation API while it renders. The mp4
 * itself is not stored: 'rendered' is computed on the fly from the API's answer.
 */
export async function checkNote(event: H3Event, row: DailyReading): Promise<NoteResponse> {
  if (row.noteStatus !== 'pending' || !row.noteJob) return toNoteResponse(row)
  const result = await fetchResult(event, row.noteJob)
  if (result === null) {
    await failNote(row.id, 'the generation API lost the job')
    return { status: 'failed', fileId: null, error: 'the generation API lost the job' }
  }
  if (result.status === 'done') return { status: 'rendered', fileId: null, error: null }
  if (result.status === 'error') {
    const message = String(result.data ?? 'render failed')
    await failNote(row.id, message)
    return { status: 'failed', fileId: null, error: message }
  }
  return { status: 'pending', fileId: null, error: null }
}

/** The rendered mp4, straight from the generation API. */
export async function noteVideo(event: H3Event, row: DailyReading): Promise<Buffer | null> {
  if (!row.noteJob) return null
  const result = await fetchResult(event, row.noteJob)
  if (result?.status !== 'done' || !result.data) return null
  return Buffer.from(result.data, 'base64')
}

/** The bot uploaded it — from now on Telegram's file_id is the note. */
export async function markNoteSent(id: string, fileId: string): Promise<void> {
  await useDb()
    .update(dailyReadings)
    .set({ noteStatus: 'ready', noteFileId: fileId, noteError: null })
    .where(eq(dailyReadings.id, id))
}
