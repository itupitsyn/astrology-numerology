/**
 * Video notes: Mika reads the day's reading as a Telegram "кружок".
 *
 * Two ways in: the «🎥 Кружок от Мики» button under a reading, and the /mika
 * command, which first makes sure today's reading exists (and its prose is
 * written — the script retells it). Both end in `deliver`.
 *
 * The note is written and rendered elsewhere — the script by the same LLM as
 * the prose, the video in the GPU queue on the generation box — so the bot only
 * starts it, waits, and delivers. Waiting is a minute or so; meanwhile the chat
 * shows "записывает кружок", which is what Telegram itself shows a person doing it.
 *
 * Once uploaded, Telegram's file_id goes back to the API. A second request
 * resends it by id: no render, no upload.
 */

import { type Context, InputFile } from 'grammy'
import {
  ApiError,
  NeedsProfileError,
  fetchDaily,
  fetchNoteVideo,
  noteSent,
  pollDaily,
  pollNote,
  requestNote,
} from './api'
import { config } from './config'
import { promptForProfile } from './daily'
import type { DailyResponse, NoteResponse } from './types'

const POLL_MS = 3_000
/** Script ~10 s + GPU queue + render ~40–60 s; past this, tell the user to come back. */
const TIMEOUT_MS = 5 * 60_000
/** Telegram drops a chat action after ~5 s — renew it a bit sooner. */
const ACTION_MS = 4_500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Notes being produced right now, so a double tap does not start a second wait. */
const busy = new Set<string>()

/** Keeps "записывает кружок" on screen while something slow happens. */
function recording(ctx: Context) {
  let acted = 0
  return async () => {
    if (Date.now() - acted > ACTION_MS) {
      await ctx.replyWithChatAction('record_video_note').catch(() => {})
      acted = Date.now()
    }
  }
}

/** The button under a reading. */
export async function sendNote(ctx: Context, readingId: string): Promise<void> {
  await deliver(ctx, readingId, (text) => ctx.answerCallbackQuery(text ? { text } : undefined).then(() => {}))
}

/**
 * /mika — today's note straight away. Today's reading is fetched the way
 * /today does it; if its prose is still being written, we wait for it first.
 */
export async function sendNoteCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  if (!telegramId) return
  const act = recording(ctx)
  await act()

  let reading: DailyResponse
  try {
    reading = await fetchDaily(telegramId)
  } catch (err) {
    if (err instanceof NeedsProfileError) {
      await promptForProfile(ctx, err.setupUrl)
      return
    }
    console.error('[note] daily fetch failed', err)
    await ctx.reply('Не получилось построить прогноз. Попробуйте ещё раз через минуту.')
    return
  }
  const id = reading.id
  if (!id) return

  const deadline = Date.now() + config.pollTimeoutMs
  while (reading.status === 'pending' && Date.now() < deadline) {
    await act()
    await sleep(config.pollIntervalMs)
    try {
      reading = await pollDaily(id)
    } catch (err) {
      console.warn('[note] daily poll error', err)
    }
  }
  if (reading.status !== 'ready') {
    await ctx.reply('Прогноз на сегодня пока не готов, а кружок пересказывает его. Попробуйте /mika чуть позже.')
    return
  }

  // Only failures need words here: the chat action already says what is going on.
  await deliver(ctx, id, async (text) => {
    if (text && text !== STARTED) await ctx.reply(text)
  })
}

const STARTED = 'Мика записывает кружок — это около минуты.'

/**
 * Request, wait, upload. `say` tells the user how it is going — a toast for the
 * button, a message (or nothing) for the command; called at most once before
 * the wait.
 */
async function deliver(ctx: Context, readingId: string, say: (text?: string) => Promise<void>): Promise<void> {
  if (busy.has(readingId)) {
    await say('Мика уже записывает кружок — ещё немного.')
    return
  }
  busy.add(readingId)
  try {
    let note: NoteResponse
    try {
      note = await requestNote(readingId)
    } catch (err) {
      console.error('[note] request failed', err)
      await say(
        err instanceof ApiError && err.status === 503
          ? 'Кружочки пока недоступны.'
          : 'Не получилось начать запись. Попробуйте через минуту.',
      )
      return
    }

    if (note.status === 'ready' && note.fileId) {
      await say()
      await ctx.replyWithVideoNote(note.fileId)
      return
    }
    await say(STARTED)

    const act = recording(ctx)
    const deadline = Date.now() + TIMEOUT_MS
    while (note.status === 'pending' && Date.now() < deadline) {
      await act()
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

    if (note.status === 'ready' && note.fileId) {  // another request delivered it meanwhile
      await ctx.replyWithVideoNote(note.fileId)
      return
    }

    if (note.status === 'failed') {
      console.error('[note] failed', note.error)
      await ctx.reply('Не получилось записать кружок. Попробуйте ещё раз чуть позже.')
      return
    }
    await ctx.reply('Кружок ещё записывается. Попросите ещё раз через пару минут — пришлю, как будет готов.')
  } catch (err) {
    console.error('[note] delivery failed', err)
    await ctx.reply('Не получилось отправить кружок. Попробуйте ещё раз.').catch(() => {})
  } finally {
    busy.delete(readingId)
  }
}
