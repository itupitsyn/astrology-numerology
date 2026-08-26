import { requireBotAuth } from '../../utils/auth'
import { getProfileByTelegramId, profileTimezone } from '../../utils/profiles'

interface StatusBody {
  telegramId?: number
}

/**
 * POST /api/bot/profile-status
 *
 * "Does this user have usable data, and where do I send them if not."
 *
 * A single indexed read with no side effects — which is the point. Asking
 * `/api/bot/daily` instead would answer the same question, but it also claims a
 * generation slot and starts a GPU job, so a bare /start would quietly cost a
 * model run.
 *
 * A POST rather than a GET so the Telegram id travels in the body: user ids do
 * not belong in URLs, where they end up in access logs.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const body = await readBody<StatusBody>(event)
  const telegramId = Number(body?.telegramId)
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'telegramId is required' })
  }

  const { appUrl } = useRuntimeConfig(event)
  const setupUrl = `${String(appUrl).replace(/\/+$/, '')}/setup`

  const profile = await getProfileByTelegramId(telegramId)
  // A profile with no usable timezone is as good as absent: there is no
  // defensible "today" for that user until they finish the form.
  const ready = !!profile && profileTimezone(profile) !== null

  return {
    exists: ready,
    setupUrl,
    name: profile?.name ?? null,
    birthTimeUnknown: profile?.birthTimeUnknown ?? null,
  }
})
