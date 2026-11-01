import { requireBotAuth } from '../../../../utils/auth'
import { getSkyReadingById, skyVideo } from '../../../../utils/sky'

/** GET /api/bot/sky/:id/video — the rendered mp4, passed through from the generation API. */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const row = await getSkyReadingById(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'reading not found' })

  const video = await skyVideo(event, row)
  if (!video) throw createError({ statusCode: 409, statusMessage: 'the note is not rendered' })

  setHeader(event, 'Content-Type', 'video/mp4')
  return video
})
