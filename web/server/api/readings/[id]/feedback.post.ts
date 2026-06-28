import { getReading, saveFeedback } from '../../../utils/readings'

/**
 * POST /api/readings/:id/feedback — record a 👍 (1) or 👎 (-1) for a reading.
 * Body: { rating: 1 | -1, comment?: string }
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody<{ rating?: number; comment?: string }>(event)
  if (body?.rating !== 1 && body?.rating !== -1) {
    throw createError({ statusCode: 400, statusMessage: 'rating must be 1 or -1' })
  }

  const reading = await getReading(id)
  if (!reading) throw createError({ statusCode: 404, statusMessage: 'Reading not found' })

  const saved = await saveFeedback(id, body.rating, typeof body.comment === 'string' ? body.comment : undefined)
  return { ok: true, id: saved.id }
})
