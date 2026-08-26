/**
 * Daily forecast persistence, slot claiming, and text generation.
 *
 * The shape of this module is driven by one constraint: the text is generated
 * by a 35B model on a single GPU, while everything else about a day costs
 * milliseconds. So the two halves are handled separately.
 *
 *  - The **deterministic half** (transits, events, numerology) is recomputed
 *    freely by anyone who asks. Two concurrent requests both computing it is
 *    harmless — the result is identical by construction.
 *  - The **generated half** runs at most once per user per local day. The slot
 *    is claimed *before* generation starts, through a unique index, so a user
 *    who taps twice cannot start two generations.
 *
 * A claim can also be lost to a process restart, leaving a row stuck in
 * 'pending'. Claims therefore expire: a pending row older than
 * `STALE_PENDING_MS` is treated as dead and may be reclaimed.
 */

import { and, desc, eq, lt, ne, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { H3Event } from 'h3'
import {
  dailyFeedback,
  dailyReadings,
  type DailyReading,
  type Profile,
} from '../db/schema'
import type { DailyForecast } from './astro/daily'
import { useDb, type Database } from './db'
import { chatCompletion } from './llm/client'
import { buildDailyPrompt, DAILY_PROMPT_VERSION } from './llm/dailyPrompt'
import { LlmBusyError, withLlmSlot } from './llm/limiter'
import type { NumerologyResult } from './numerology/types'
import { profilePlace } from './profiles'

/** How long a claimed-but-unfinished generation is believed to be alive. */
export const STALE_PENDING_MS = 5 * 60_000

export type DailyStatus = 'pending' | 'ready' | 'failed'

export function newDailyId(): string {
  return nanoid(12)
}

/**
 * The `db` parameter exists so the claim logic can be exercised against a real
 * Postgres in tests — its whole point is a race, which a mock cannot reproduce.
 * Production callers always take the default.
 */
export async function getDailyReading(
  profileId: string,
  localDate: string,
  db: Database = useDb(),
): Promise<DailyReading | undefined> {
  return db.query.dailyReadings.findFirst({
    where: and(eq(dailyReadings.profileId, profileId), eq(dailyReadings.localDate, localDate)),
  })
}

export async function getDailyReadingById(id: string) {
  return useDb().query.dailyReadings.findFirst({
    where: eq(dailyReadings.id, id),
    with: { feedback: { orderBy: (f) => desc(f.createdAt), limit: 1 } },
  })
}

/**
 * What a caller sees. The facts are always present once a row exists, even
 * while `status` is 'pending' — that is the whole point of splitting the two
 * halves: a bot can send a real answer in milliseconds and edit the prose in
 * when it lands.
 */
export interface DailyResponse {
  /**
   * Null for a facts-only answer that was never persisted (`generate: false`).
   * No row means no id — and nothing to attach feedback to.
   */
  id: string | null
  status: DailyStatus
  date: string
  timezone: string
  forecast: DailyForecast | null
  numerology: NumerologyResult | null
  text: string | null
  model: string | null
  promptVersion: string | null
  /** Set when the last generation attempt failed; it will be retried. */
  error: string | null
}

export function toDailyResponse(row: DailyReading): DailyResponse {
  return {
    id: row.id,
    status: row.status as DailyStatus,
    date: row.localDate,
    timezone: row.timezone,
    forecast: row.forecast ?? null,
    numerology: row.numerology ?? null,
    text: row.interpretation ?? null,
    model: row.model ?? null,
    promptVersion: row.promptVersion ?? null,
    error: row.error ?? null,
  }
}

/**
 * A facts-only answer that was never written to the database.
 *
 * Used by callers that must not cause work — inline queries arrive on every
 * keystroke, so they may compute, but they may not claim a slot or start a
 * model run.
 */
export function toEphemeralDailyResponse(input: {
  localDate: string
  timezone: string
  forecast: DailyForecast
  numerology: NumerologyResult
}): DailyResponse {
  return {
    id: null,
    status: 'pending',
    date: input.localDate,
    timezone: input.timezone,
    forecast: input.forecast,
    numerology: input.numerology,
    text: null,
    model: null,
    promptVersion: null,
    error: null,
  }
}

export interface ClaimInput {
  profile: Profile
  localDate: string
  timezone: string
  forecast: DailyForecast
  numerology: NumerologyResult
}

export interface ClaimResult {
  row: DailyReading
  /** True when *this* caller took the slot and is responsible for generating. */
  claimed: boolean
}

/**
 * Take the generation slot for (profile, local date), or report who holds it.
 *
 * Returns `claimed: false` when another request is already generating, or has
 * already produced an up-to-date reading. Either way `row` is the current
 * state, so the caller can always answer with whatever facts exist.
 */
export async function claimDailySlot(
  input: ClaimInput,
  db: Database = useDb(),
): Promise<ClaimResult> {
  const { profile, localDate, timezone, forecast, numerology } = input

  const fresh = {
    status: 'pending' as DailyStatus,
    claimedAt: new Date(),
    profileVersion: profile.version,
    timezone,
    forecast,
    numerology,
    // Clear any previous attempt's output so a stale text can never be served
    // alongside freshly recomputed facts.
    interpretation: null,
    error: null,
    model: null,
    promptVersion: null,
    usage: null,
  }

  // First attempt: nobody has a row for this day yet. ON CONFLICT DO NOTHING
  // makes this the atomic claim — exactly one concurrent insert returns a row.
  const [inserted] = await db
    .insert(dailyReadings)
    .values({
      id: newDailyId(),
      profileId: profile.id,
      localDate,
      ...fresh,
    })
    .onConflictDoNothing({ target: [dailyReadings.profileId, dailyReadings.localDate] })
    .returning()

  if (inserted) return { row: inserted, claimed: true }

  // A row exists. It may be reclaimable: the profile changed underneath it, the
  // last attempt failed, or a claim was abandoned by a restart. The UPDATE is
  // itself the lock — its WHERE decides, and only one caller gets a row back.
  const staleBefore = new Date(Date.now() - STALE_PENDING_MS)
  const [reclaimed] = await db
    .update(dailyReadings)
    .set(fresh)
    .where(
      and(
        eq(dailyReadings.profileId, profile.id),
        eq(dailyReadings.localDate, localDate),
        or(
          ne(dailyReadings.profileVersion, profile.version),
          eq(dailyReadings.status, 'failed'),
          and(
            eq(dailyReadings.status, 'pending'),
            lt(dailyReadings.claimedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning()

  if (reclaimed) return { row: reclaimed, claimed: true }

  // Someone else holds a valid slot — return their row as it stands now.
  const current = await getDailyReading(profile.id, localDate, db)
  if (current) return { row: current, claimed: false }

  // Extremely unlikely: the row was deleted between our two statements. Retry
  // once rather than inventing a result.
  return claimDailySlot(input, db)
}

export async function finishDailyReading(
  id: string,
  result: {
    interpretation: string
    model?: string | null
    usage?: Record<string, number> | null
    promptVersion: string
  },
  db: Database = useDb(),
): Promise<void> {
  await db
    .update(dailyReadings)
    .set({
      status: 'ready',
      interpretation: result.interpretation,
      model: result.model ?? null,
      usage: result.usage ?? null,
      promptVersion: result.promptVersion,
      error: null,
    })
    .where(eq(dailyReadings.id, id))
}

export async function failDailyReading(
  id: string,
  message: string,
  db: Database = useDb(),
): Promise<void> {
  await db
    .update(dailyReadings)
    .set({ status: 'failed', error: message.slice(0, 500) })
    .where(eq(dailyReadings.id, id))
}

export async function saveDailyFeedback(dailyId: string, rating: number, comment?: string) {
  const [row] = await useDb()
    .insert(dailyFeedback)
    .values({ id: nanoid(12), dailyId, rating, comment })
    .returning()
  return row
}

/**
 * Generate the prose for a claimed reading and store it.
 *
 * Runs inside the LLM concurrency budget. Never throws: the row is the record
 * of what happened, and a failure there simply lets the next request retry.
 */
export async function generateDailyText(
  event: H3Event,
  row: DailyReading,
  profile: Profile,
): Promise<void> {
  try {
    if (!row.forecast || !row.numerology) {
      throw new Error('reading has no computed facts to narrate')
    }

    const messages = buildDailyPrompt({
      forecast: row.forecast,
      numerology: row.numerology,
      subjectName: profile.name ?? profile.fullName,
      city: profilePlace(profile).city,
    })

    const llm = await withLlmSlot(() => chatCompletion(event, messages, { temperature: 0.7 }))

    if (!llm.content) throw new Error('LLM returned an empty completion')

    await finishDailyReading(row.id, {
      interpretation: llm.content,
      model: llm.model,
      usage: llm.usage ?? null,
      promptVersion: DAILY_PROMPT_VERSION,
    })
  } catch (err) {
    const busy = err instanceof LlmBusyError
    const message = busy
      ? 'LLM is busy — the forecast text will be retried on the next request'
      : err instanceof Error
        ? err.message
        : String(err)
    // Either way the row goes to 'failed', which is what makes the next request
    // reclaim the slot and try again instead of waiting on a dead generation.
    await failDailyReading(row.id, message).catch(() => {})
  }
}
