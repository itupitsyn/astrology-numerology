import { requireBotAuth } from '../../../utils/auth'
import { getDailyReadingById, toDailyResponse } from '../../../utils/daily'

/**
 * GET /api/bot/daily/:id
 *
 * The poll endpoint for phase two. Cheap by design — a single indexed read, no
 * astro-service call, no recomputation — so a bot can check it every couple of
 * seconds while the text generates without costing anything.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const row = await getDailyReadingById(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'reading not found' })

  return toDailyResponse(row)
})
