/**
 * Video notes: Mika reads the day's reading as a Telegram "кружок".
 *
 * Two ways in: the «🎥 Кружок от Мики» button under a reading, and the /mika
 * command, which first makes sure today's reading exists (and its prose is
 * written — the script retells it). Both end in `deliver`.
 *
 * Inline mode (`@bot` in any chat) is the third way, and it gets a plain square
 * video instead: Telegram has no inline result for a video note, and an inline
 * message cannot be edited into one. See `sendInlineNote`.
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
import { inlineNoteKeyboard } from './keyboards'
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

  let id: string | null
  try {
    id = await todayReadingId(telegramId, act)
  } catch (err) {
    if (err instanceof NeedsProfileError) {
      await promptForProfile(ctx, err.setupUrl)
      return
    }
    console.error('[note] daily fetch failed', err)
    await ctx.reply('Не получилось построить прогноз. Попробуйте ещё раз через минуту.')
    return
  }
  if (!id) {
    await ctx.reply('Прогноз на сегодня пока не готов, а кружок пересказывает его. Попробуйте /mika чуть позже.')
    return
  }

  // Only failures need words here: the chat action already says what is going on.
  await deliver(ctx, id, async (text) => {
    if (text && text !== STARTED) await ctx.reply(text)
  })
}

const STARTED = 'Мика записывает кружок — это около минуты.'

/** Today's reading with its prose written, or null if the prose did not come in time. */
async function todayReadingId(telegramId: number, tick: () => Promise<void>): Promise<string | null> {
  let reading: DailyResponse = await fetchDaily(telegramId)
  const id = reading.id
  if (!id) return null

  const deadline = Date.now() + config.pollTimeoutMs
  while (reading.status === 'pending' && Date.now() < deadline) {
    await tick()
    await sleep(config.pollIntervalMs)
    try {
      reading = await pollDaily(id)
    } catch (err) {
      console.warn('[note] daily poll error', err)
    }
  }
  return reading.status === 'ready' ? id : null
}

/** Polls until the note stops being 'pending' or the deadline passes. */
async function waitForNote(readingId: string, first: NoteResponse, tick: () => Promise<void>): Promise<NoteResponse> {
  let note = first
  const deadline = Date.now() + TIMEOUT_MS
  while (note.status === 'pending' && Date.now() < deadline) {
    await tick()
    await sleep(POLL_MS)
    try {
      note = await pollNote(readingId)
    } catch (err) {
      console.warn('[note] poll error', err)  // a blip; the deadline bounds us
    }
  }
  return note
}

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

    note = await waitForNote(readingId, note, recording(ctx))

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

const INLINE_STARTED = '🎥 Мика записывает прогноз — это около минуты.'
const INLINE_FAILED = 'Не получилось записать прогноз. Попробуйте ещё раз.'

/** Inline messages being recorded, so a double tap does not start a second upload. */
const inlineBusy = new Set<string>()

/** Removes a parked upload. The result is already out, so a leftover is only logged. */
async function dropFromServiceChat(ctx: Context, chatId: string, messageId: number): Promise<void> {
  await ctx.api.deleteMessage(chatId, messageId).catch((err) => console.warn('[note] service chat cleanup', err))
}

/**
 * An already sent note, downloaded back from Telegram. The generation API keeps
 * the mp4 for only a few hours, and a note recorded in the morning can be asked
 * for in the evening. The errors stay generic: this URL contains the bot token.
 */
async function downloadSentNote(ctx: Context, fileId: string): Promise<Uint8Array> {
  const file = await ctx.api.getFile(fileId)
  if (!file.file_path) throw new Error('Telegram gave no path for the note')
  const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`
  const proxy = config.telegramProxyUrl
  let response: Response
  try {
    // `proxy` is Bun's extension to fetch; only Telegram traffic goes through it.
    response = await fetch(url, { signal: AbortSignal.timeout(60_000), ...(proxy ? { proxy } : {}) } as RequestInit)
  } catch {
    throw new Error('could not download the note from Telegram')
  }
  if (!response.ok) throw new Error(`note download: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** The mp4 of today's note, recording it first if nobody has asked for it yet. */
async function noteBytes(ctx: Context, chatId: string, telegramId: number): Promise<Uint8Array> {
  const readingId = await todayReadingId(telegramId, async () => {})
  if (!readingId) throw new Error('the reading is not ready')

  const note = await waitForNote(readingId, await requestNote(readingId), async () => {})
  if (note.status === 'ready' && note.fileId) return downloadSentNote(ctx, note.fileId)
  if (note.status !== 'rendered') throw new Error(`note is ${note.status}: ${note.error ?? 'timed out'}`)

  const video = await fetchNoteVideo(readingId)
  // Upload it as a note too and record that: otherwise the claim goes stale, and
  // the next /mika would pay for a second render of the same video.
  const parked = await ctx.api.sendVideoNote(chatId, new InputFile(video, 'mika.mp4'), { length: 640 })
  const fileId = parked.video_note?.file_id
  if (fileId) await noteSent(readingId, fileId).catch((err) => console.error('[note] sent failed', err))
  await dropFromServiceChat(ctx, chatId, parked.message_id)
  return video
}

/**
 * The button under an inline message: the placeholder turns into the video.
 *
 * An inline message cannot take an upload, only a file Telegram already knows,
 * so the video is parked in a service chat first. Everyone in the chat sees the
 * button, but the forecast is its sender's: only they can start it.
 */
export async function sendInlineNote(ctx: Context, ownerId: number): Promise<void> {
  const messageId = ctx.callbackQuery?.inline_message_id
  if (!messageId) return
  if (ctx.from?.id !== ownerId) {
    await ctx.answerCallbackQuery({ text: 'Это прогноз того, кто его отправил. Наберите имя бота в чате, и будет ваш.' })
    return
  }
  const chatId = config.noteChatId
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: 'Видео от Мики пока недоступно.' })
    return
  }
  if (inlineBusy.has(messageId)) {
    await ctx.answerCallbackQuery({ text: 'Мика уже записывает — ещё немного.' })
    return
  }

  inlineBusy.add(messageId)
  try {
    await ctx.answerCallbackQuery()
    await ctx.api.editMessageTextInline(messageId, INLINE_STARTED)  // no markup: this removes the button

    const video = await noteBytes(ctx, chatId, ownerId)
    const parked = await ctx.api.sendVideo(chatId, new InputFile(video, 'mika.mp4'), {
      width: 640,
      height: 640,
      supports_streaming: true,
    })
    const fileId = parked.video?.file_id
    if (!fileId) throw new Error('Telegram did not take the upload as a video')
    await ctx.api.editMessageMediaInline(messageId, {
      type: 'video',
      media: fileId,
      width: 640,
      height: 640,
      supports_streaming: true,
    })
    await dropFromServiceChat(ctx, chatId, parked.message_id)
  } catch (err) {
    console.error('[note] inline failed', err)
    await ctx.api
      .editMessageTextInline(messageId, INLINE_FAILED, { reply_markup: inlineNoteKeyboard(ownerId) })
      .catch(() => {})
  } finally {
    inlineBusy.delete(messageId)
  }
}
