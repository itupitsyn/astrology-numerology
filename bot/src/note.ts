/**
 * «🎥 Кружок от Мики»: Mika reads the day's reading as a Telegram video note.
 *
 * The note is written and rendered elsewhere — the script by the same LLM as
 * the prose, the video in the GPU queue on the generation box — so the bot only
 * starts it, waits, and delivers. Waiting is a minute or so; meanwhile the chat
 * shows "записывает кружок", which is what Telegram itself shows a person doing it.
 *
 * Once uploaded, Telegram's file_id goes back to the API. A second tap — or
 * another day's visit to the same reading — resends it by id: no render, no upload.
 */

import { type Context, InputFile } from 'grammy'
import { ApiError, fetchNoteVideo, noteSent, pollNote, requestNote } from './api'
import type { NoteResponse } from './types'

const POLL_MS = 3_000
/** Script ~10 s + GPU queue + render ~40–60 s; past this, tell the user to come back. */
const TIMEOUT_MS = 5 * 60_000
/** Telegram drops a chat action after ~5 s — renew it a bit sooner. */
const ACTION_MS = 4_500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Notes being produced right now, so a double tap does not start a second wait. */
const busy = new Set<string>()

export async function sendNote(ctx: Context, readingId: string): Promise<void> {
  if (busy.has(readingId)) {
    await ctx.answerCallbackQuery({ text: 'Мика уже записывает кружок — ещё немного.' })
    return
  }
  busy.add(readingId)
  try {
    let note: NoteResponse
    try {
      note = await requestNote(readingId)
    } catch (err) {
      console.error('[note] request failed', err)
      await ctx.answerCallbackQuery({
        text:
          err instanceof ApiError && err.status === 503
            ? 'Кружочки пока недоступны.'
            : 'Не получилось начать запись. Попробуйте через минуту.',
      })
      return
    }

    if (note.status === 'ready' && note.fileId) {
      await ctx.answerCallbackQuery()
      await ctx.replyWithVideoNote(note.fileId)
      return
    }
    await ctx.answerCallbackQuery({ text: 'Мика записывает кружок — это около минуты.' })

    const deadline = Date.now() + TIMEOUT_MS
    let acted = 0
    while (note.status === 'pending' && Date.now() < deadline) {
      if (Date.now() - acted > ACTION_MS) {
        await ctx.replyWithChatAction('record_video_note').catch(() => {})
        acted = Date.now()
      }
      await sleep(POLL_MS)
      try {
        note = await pollNote(readingId)
      } catch (err) {
        console.warn('[note] poll error', err)  // a blip; the deadline bounds us
      }
    }

    if (note.status === 'rendered') {
      await ctx.replyWithChatAction('upload_video_note').catch(() => {})
      const video = await fetchNoteVideo(readingId)
      const sent = await ctx.replyWithVideoNote(new InputFile(video, 'mika.mp4'), { length: 640 })
      const fileId = sent.video_note?.file_id
      if (fileId) await noteSent(readingId, fileId).catch((err) => console.error('[note] sent failed', err))
      return
    }

    if (note.status === 'ready' && note.fileId) {  // another tap delivered it meanwhile
      await ctx.replyWithVideoNote(note.fileId)
      return
    }

    if (note.status === 'failed') {
      console.error('[note] failed', note.error)
      await ctx.reply('Не получилось записать кружок. Нажмите кнопку ещё раз чуть позже.')
      return
    }
    await ctx.reply('Кружок ещё записывается. Нажмите кнопку через пару минут — пришлю, как будет готов.')
  } catch (err) {
    console.error('[note] delivery failed', err)
    await ctx.reply('Не получилось отправить кружок. Попробуйте ещё раз.').catch(() => {})
  } finally {
    busy.delete(readingId)
  }
}
