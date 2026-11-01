import { eq } from 'drizzle-orm'
import { dailyReadings } from '../../../../../db/schema'
import { requireBotAuth } from '../../../../../utils/auth'
import { noteVideo } from '../../../../../utils/dailyNote'
import { useDb } from '../../../../../utils/db'

/**
 * GET /api/bot/daily/:id/note/video
 *
 * The rendered mp4, passed through from the generation API. Fetched once, by
 * the bot, to upload it; after that Telegram's file_id stands in for it.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const row = await useDb().query.dailyReadings.findFirst({ where: eq(dailyReadings.id, id) })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'reading not found' })

  const video = await noteVideo(event, row)
  if (!video) throw createError({ statusCode: 409, statusMessage: 'the note is not rendered' })

  setHeader(event, 'Content-Type', 'video/mp4')
  return video
})
