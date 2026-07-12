import { getHoraryReading, saveHoraryFeedback } from '../../../utils/readings'

/**
 * POST /api/horary/:id/feedback — record a 👍 (1) or 👎 (-1) for a horary reading.
 * Body: { rating: 1 | -1, comment?: string }
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = await readBody<{ rating?: number; comment?: string }>(event)
  if (body?.rating !== 1 && body?.rating !== -1) {
    throw createError({ statusCode: 400, statusMessage: 'rating must be 1 or -1' })
  }

  const reading = await getHoraryReading(id)
  if (!reading) throw createError({ statusCode: 404, statusMessage: 'Horary reading not found' })

  const saved = await saveHoraryFeedback(id, body.rating, typeof body.comment === 'string' ? body.comment : undefined)
  return { ok: true, id: saved.id }
})
