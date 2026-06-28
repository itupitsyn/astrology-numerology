import { getReading } from '../../utils/readings'

/**
 * GET /api/readings/:id — public share payload.
 * The owner's name is intentionally omitted (privacy); the chart snapshot,
 * numerology and interpretation are returned as-is.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const reading = await getReading(id)
  if (!reading) throw createError({ statusCode: 404, statusMessage: 'Reading not found' })

  // Strip personally identifying fields from the public response.
  return {
    id: reading.id,
    createdAt: reading.createdAt,
    chart: reading.chart,
    numerology: reading.numerology,
    interpretation: reading.interpretation,
    targetYear: reading.targetYear,
    focus: reading.focus,
    model: reading.model,
  }
})
