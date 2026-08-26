import { requireBotAuth } from '../../utils/auth'
import { fetchDailyForecast } from '../../utils/astro/client'
import {
  claimDailySlot,
  generateDailyText,
  getDailyReading,
  toDailyResponse,
  toEphemeralDailyResponse,
} from '../../utils/daily'
import { localDateIn, parseLocalDate } from '../../utils/localDate'
import { computeNumerology } from '../../utils/numerology/core'
import {
  getProfileByTelegramId,
  profileBirthData,
  profilePlace,
  profileTimezone,
} from '../../utils/profiles'

interface BotDailyBody {
  /** Telegram numeric user id. The bot stores nothing else. */
  telegramId?: number
  /** Local date override (YYYY-MM-DD). Defaults to today at the user's place. */
  date?: string
  /**
   * Set false to get the facts without causing any work: no slot is claimed, no
   * model run starts, and nothing is written. For inline queries, which Telegram
   * fires on every keystroke — generating there would mean a GPU job per letter.
   */
  generate?: boolean
}

/**
 * The snapshot hour for the day's positions.
 *
 * Fixed rather than "now" on purpose: the reading is cached for the whole day,
 * so a request at 09:00 and one at 21:00 must produce the same facts. Noon is
 * the least wrong single instant for a 24-hour window — and the parts that
 * genuinely move (ingresses, exact aspects, void-of-course windows) are scanned
 * across the whole day anyway, with their own local times.
 */
const REFERENCE_HOUR = 12

/**
 * POST /api/bot/daily
 *
 * The bot's one entry point. Answers in two phases:
 *
 *   - `status: 'ready'`   — text included, nothing to wait for.
 *   - `status: 'pending'` — facts are included and generation has just started;
 *     poll `GET /api/bot/daily/:id` and edit the message when it turns ready.
 *
 * A user with no profile gets **409** carrying `setupUrl`, which is the bot's
 * cue to send them to the web app instead of an error message.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const body = await readBody<BotDailyBody>(event)
  const telegramId = Number(body?.telegramId)
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'telegramId is required' })
  }

  const { appUrl } = useRuntimeConfig(event)
  const setupUrl = `${String(appUrl).replace(/\/+$/, '')}/setup`

  const profile = await getProfileByTelegramId(telegramId)
  if (!profile) {
    throw createError({
      statusCode: 409,
      statusMessage: 'profile required',
      data: { needsProfile: true, setupUrl },
    })
  }

  const timezone = profileTimezone(profile)
  if (!timezone) {
    // The profile predates a timezone being stored, or was written with an
    // unknown zone. Without it there is no defensible "today" for this user.
    throw createError({
      statusCode: 409,
      statusMessage: 'profile is missing a usable timezone',
      data: { needsProfile: true, setupUrl },
    })
  }

  let localDate: string
  if (body?.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw createError({ statusCode: 400, statusMessage: 'date must be YYYY-MM-DD' })
    }
    localDate = body.date
  } else {
    localDate = localDateIn(timezone)
  }

  const generate = body?.generate !== false

  // Fast path: an up-to-date reading already exists, so nothing is recomputed
  // and no GPU is touched.
  const existing = await getDailyReading(profile.id, localDate)
  const usable = !!existing && existing.profileVersion === profile.version

  if (usable && existing!.status === 'ready') {
    return toDailyResponse(existing!)
  }
  // Facts-only caller, and the facts are already stored: one indexed read and
  // we are done — no astro-service round trip either.
  if (!generate && usable && existing!.forecast) {
    return toDailyResponse(existing!)
  }

  // The deterministic half. Cheap enough that two racing requests may both do
  // it — the result is identical by construction, so only the slot needs a lock.
  const place = profilePlace(profile)
  const forecast = await fetchDailyForecast(event, {
    birth: profileBirthData(profile),
    place,
    date: localDate,
    reference_hour: REFERENCE_HOUR,
    // No birth time means no houses and no angles — see the profile schema.
    houses_known: !profile.birthTimeUnknown,
  })

  const { year, month, day } = parseLocalDate(localDate)
  const numerology = computeNumerology({
    birth: {
      year: profile.birthYear,
      month: profile.birthMonth,
      day: profile.birthDay,
    },
    fullName: profile.fullName ?? undefined,
    targetDate: { year, month, day },
  })

  // Facts-only: hand them back without persisting. Writing here would mean
  // claiming the slot, and a keystroke must not decide who gets the GPU.
  if (!generate) {
    return toEphemeralDailyResponse({ localDate, timezone, forecast, numerology })
  }

  const { row, claimed } = await claimDailySlot({
    profile,
    localDate,
    timezone,
    forecast,
    numerology,
  })

  if (claimed) {
    // Detached on purpose: the caller gets the facts now, the prose later.
    // `generateDailyText` never throws — it records the outcome on the row.
    void generateDailyText(event, row, profile)
  }

  return toDailyResponse(row)
})
