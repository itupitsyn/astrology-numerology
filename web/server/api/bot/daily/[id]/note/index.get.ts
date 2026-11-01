import { eq } from 'drizzle-orm'
import { dailyReadings } from '../../../../../db/schema'
import { requireBotAuth } from '../../../../../utils/auth'
import { checkNote } from '../../../../../utils/dailyNote'
import { useDb } from '../../../../../utils/db'

/**
 * GET /api/bot/daily/:id/note
 *
 * The poll endpoint for a note. While it renders, asks the generation API —
 * one small request, so every few seconds is fine. `rendered` means the mp4 is
 * waiting at GET …/note/video.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const row = await useDb().query.dailyReadings.findFirst({ where: eq(dailyReadings.id, id) })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'reading not found' })

  return checkNote(event, row)
})
