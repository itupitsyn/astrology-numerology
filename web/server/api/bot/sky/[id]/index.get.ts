import { requireBotAuth } from '../../../../utils/auth'
import { checkSky, getSkyReadingById } from '../../../../utils/sky'

/** GET /api/bot/sky/:id — where the note stands, asking the generation API while it renders. */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const row = await getSkyReadingById(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'reading not found' })

  return checkSky(event, row)
})
