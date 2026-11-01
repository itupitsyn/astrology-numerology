import { eq } from 'drizzle-orm'
import { profiles } from '../../../../../db/schema'
import { requireBotAuth } from '../../../../../utils/auth'
import { claimNote, notesEnabled, produceNote, toNoteResponse } from '../../../../../utils/dailyNote'
import { useDb } from '../../../../../utils/db'

/**
 * POST /api/bot/daily/:id/note
 *
 * «🎥 Кружок от Мики». Takes the note slot and starts the work detached —
 * script, then render — or reports where an earlier request got to. A note
 * sent before comes back as `ready` with its Telegram `fileId`: no new render.
 *
 * 409 while the prose itself is not ready (the script retells it), 503 when
 * notes are not configured here.
 */
export default defineEventHandler(async (event) => {
  requireBotAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  if (!notesEnabled(event)) {
    throw createError({ statusCode: 503, statusMessage: 'video notes are not configured' })
  }

  const { row, claimed } = await claimNote(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'reading not found' })
  if (row.status !== 'ready') {
    throw createError({ statusCode: 409, statusMessage: 'the reading text is not ready yet' })
  }

  if (claimed) {
    const profile = await useDb().query.profiles.findFirst({ where: eq(profiles.id, row.profileId) })
    // Detached on purpose, like the prose: the bot polls GET for the outcome.
    void produceNote(event, row, profile?.name)
  }
  return toNoteResponse(row)
})
