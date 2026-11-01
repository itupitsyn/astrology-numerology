import { requireBotAuth } from '../../../../../utils/auth'
import { markNoteSent } from '../../../../../utils/dailyNote'

/**
 * POST /api/bot/daily/:id/note/sent  { fileId }
 *
 * The bot uploaded the note; Telegram's file_id is all we keep of it.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody<{ fileId?: string }>(event)
  const fileId = body?.fileId?.trim()
  if (!fileId || fileId.length > 256) {
    throw createError({ statusCode: 400, statusMessage: 'fileId is required' })
  }

  await markNoteSent(id, fileId)
  return { ok: true }
})
