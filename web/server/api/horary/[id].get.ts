import { getHoraryReading } from '../../utils/readings'

/**
 * GET /api/horary/:id — public share payload for a horary reading.
 * Returns the chart snapshot, verdict and interpretation; no extra PII beyond
 * the question the user chose to ask.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const reading = await getHoraryReading(id)
  if (!reading) throw createError({ statusCode: 404, statusMessage: 'Horary reading not found' })

  return {
    id: reading.id,
    createdAt: reading.createdAt,
    question: reading.question,
    verdict: reading.verdict,
    horary: reading.horary,
    interpretation: reading.interpretation,
    model: reading.model,
  }
})
