/**
 * /sky: Mika tells how the day looks for everybody, as a video note.
 *
 * Needs no profile, so it works for anyone and in any group the bot is in. The
 * note is one per day for all chats: whoever asks first waits for the render, and
 * everyone after that gets it at once by Telegram's file_id. The caller runs this
 * detached, so waiting here holds nobody up.
 */

import { type Context, InlineKeyboard, InputFile } from 'grammy'
import { ApiError, fetchSkyVideo, pollSky, requestSky, skySent } from './api'
import { recording, waitForNote } from './note'
import type { NoteResponse } from './types'

/** Chats waiting for the note, so a repeated command does not send it twice. */
const busy = new Set<number>()

export async function sendSky(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id
  if (!chatId) return
  if (busy.has(chatId)) {
    await ctx.reply('Мика уже записывает кружок — ещё немного.')
    return
  }

  // In a group, the way from the common forecast to a personal one.
  const keyboard =
    ctx.chat?.type === 'private'
      ? undefined
      : new InlineKeyboard().url('🔮 Личный прогноз', `https://t.me/${ctx.me.username}`)

  busy.add(chatId)
  try {
    const act = recording(ctx)
    await act()

    const sky = await requestSky()
    const note: NoteResponse = await waitForNote(() => pollSky(sky.id), sky, act)

    if (note.status === 'ready' && note.fileId) {
      await ctx.replyWithVideoNote(note.fileId, { reply_markup: keyboard })
    } else if (note.status === 'rendered') {
      await ctx.replyWithChatAction('upload_video_note').catch(() => {})
      const video = await fetchSkyVideo(sky.id)
      const sent = await ctx.replyWithVideoNote(new InputFile(video, 'mika.mp4'), { length: 640, reply_markup: keyboard })
      const fileId = sent.video_note?.file_id
      if (fileId) await skySent(sky.id, fileId).catch((err) => console.error('[sky] sent failed', err))
    } else if (note.status === 'failed') {
      console.error('[sky] failed', note.error)
      await ctx.reply('Не получилось записать кружок. Попробуйте /sky чуть позже.')
    } else {
      await ctx.reply('Кружок ещё записывается. Вызовите /sky через пару минут.')
    }
  } catch (err) {
    console.error('[sky] delivery failed', err)
    const off = err instanceof ApiError && err.status === 503
    await ctx.reply(off ? 'Кружочки пока недоступны.' : 'Не получилось записать кружок. Попробуйте /sky чуть позже.').catch(() => {})
  } finally {
    busy.delete(chatId)
  }
}
