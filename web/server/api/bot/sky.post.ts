import { requireBotAuth } from '../../utils/auth'
import { fetchSkyForecast } from '../../utils/astro/client'
import { notesEnabled } from '../../utils/dailyNote'
import { localDateIn } from '../../utils/localDate'
import { claimSkySlot, getSkyReading, produceSky, SKY_TIMEZONE, toSkyResponse } from '../../utils/sky'

/**
 * POST /api/bot/sky
 *
 * Mika's general forecast for today. Needs no profile. Starts the note if nobody
 * has yet, or reports where it stands; a note sent before comes back as `ready`
 * with its `fileId`. The bot polls `GET /api/bot/sky/:id`. 503 when notes are not
 * configured here.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)
  if (!notesEnabled(event)) {
    throw createError({ statusCode: 503, statusMessage: 'video notes are not configured' })
  }

  const localDate = localDateIn(SKY_TIMEZONE)
  const existing = await getSkyReading(localDate, SKY_TIMEZONE)
  if (existing?.status === 'ready') return toSkyResponse(existing)

  const forecast = await fetchSkyForecast(event, { timezone: SKY_TIMEZONE, date: localDate })
  const { row, claimed } = await claimSkySlot({ localDate, timezone: SKY_TIMEZONE, forecast })

  // Detached on purpose: the bot polls for the outcome.
  if (claimed) void produceSky(event, row)

  return toSkyResponse(row)
})
