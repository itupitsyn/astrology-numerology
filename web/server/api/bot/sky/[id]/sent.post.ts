import { requireBotAuth } from '../../../../utils/auth'
import { markSkySent } from '../../../../utils/sky'

/** POST /api/bot/sky/:id/sent { fileId } — the bot uploaded the note; every chat reuses its file_id. */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody<{ fileId?: string }>(event)
  const fileId = body?.fileId?.trim()
  if (!fileId || fileId.length > 256) {
    throw createError({ statusCode: 400, statusMessage: 'fileId is required' })
  }

  await markSkySent(id, fileId)
  return { ok: true }
})
