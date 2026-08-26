import { requireBotAuth } from '../../../../utils/auth'
import { getDailyReadingById, saveDailyFeedback } from '../../../../utils/daily'

/**
 * POST /api/bot/daily/:id/feedback — record a 👍 (1) or 👎 (-1) for a forecast.
 * Body: { rating: 1 | -1, comment?: string }
 *
 * Same shape as the natal and horary feedback endpoints; this is the fuel for
 * comparing prompt versions and models against each other.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody<{ rating?: number; comment?: string }>(event)
  if (body?.rating !== 1 && body?.rating !== -1) {
    throw createError({ statusCode: 400, statusMessage: 'rating must be 1 or -1' })
  }

  const reading = await getDailyReadingById(id)
  if (!reading) throw createError({ statusCode: 404, statusMessage: 'Reading not found' })

  const saved = await saveDailyFeedback(
    id,
    body.rating,
    typeof body.comment === 'string' ? body.comment : undefined,
  )
  return { ok: true, id: saved!.id }
})
