/**
 * The two-phase answer.
 *
 * Phase one is the transits, events and numerology: milliseconds, no GPU, and
 * already a complete answer on its own. It goes out immediately.
 *
 * Phase two is the model's prose, which can take a minute on one card. It is
 * edited into the same message when it lands, so the chat stays one clean
 * reading rather than two half-answers.
 *
 * If the model never answers, phase one still stands. That is the whole reason
 * for splitting them.
 */

import type { Context } from 'grammy'
import { ApiError, NeedsProfileError, fetchDaily, pollDaily } from './api'
import { config } from './config'
import {
  FAILED_NOTE,
  GENERATING_NOTE,
  MAX_MESSAGE_LENGTH,
  TIMEOUT_NOTE,
  renderFacts,
  renderFull,
  renderProse,
} from './format'
import { canOpenAsMiniApp, feedbackKeyboard, setupKeyboard } from './keyboards'
import type { DailyResponse } from './types'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Readings currently being polled, so a double tap does not double-poll. */
const polling = new Set<string>()

export async function promptForProfile(ctx: Context, setupUrl: string): Promise<void> {
  const keyboard = setupKeyboard(setupUrl)
  const intro =
    'Чтобы составить прогноз, мне нужны ваши данные: дата, время и место рождения. ' +
    'Спрошу один раз — дальше просто присылайте /today.'

  await ctx.reply(
    canOpenAsMiniApp(setupUrl) ? intro : `${intro}\n\nОткройте форму: ${setupUrl}`,
    { reply_markup: keyboard },
  )
}

export async function sendDaily(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  if (!telegramId) return

  await ctx.replyWithChatAction('typing').catch(() => {})

  let reading: DailyResponse
  try {
    reading = await fetchDaily(telegramId)
  } catch (err) {
    if (err instanceof NeedsProfileError) {
      await promptForProfile(ctx, err.setupUrl)
      return
    }
    console.error('[daily] fetch failed', err)
    await ctx.reply(
      err instanceof ApiError && err.status === 503
        ? 'Сервис сейчас занят. Попробуйте через минуту.'
        : 'Не получилось построить прогноз. Попробуйте ещё раз через минуту.',
    )
    return
  }

  // Already generated earlier today — nothing to wait for.
  if (reading.status === 'ready' && reading.text) {
    await replyComplete(ctx, reading)
    return
  }

  const sent = await ctx.reply(`${renderFacts(reading)}\n\n${GENERATING_NOTE}`, {
    parse_mode: 'HTML',
  })

  // `/today` always generates, so a claimed row — and its id — must exist.
  if (!reading.id) return

  // Detached: the user already has a usable answer, so nothing blocks on this.
  void awaitProse(ctx, sent.chat.id, sent.message_id, reading.id, reading).catch((err) =>
    console.error('[daily] polling failed', err),
  )
}

/** Send a finished reading, splitting it if Telegram will not take one message. */
async function replyComplete(ctx: Context, reading: DailyResponse): Promise<void> {
  // A persisted reading always has an id; a facts-only one has nothing to rate.
  const keyboard = reading.id ? feedbackKeyboard(reading.id) : undefined
  const full = renderFull(reading)
  if (full) {
    await ctx.reply(full, { parse_mode: 'HTML', reply_markup: keyboard })
    return
  }
  await ctx.reply(renderFacts(reading), { parse_mode: 'HTML' })
  await ctx.reply(clip(renderProse(reading.text ?? '')), {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
}

function clip(html: string): string {
  return html.length <= MAX_MESSAGE_LENGTH ? html : `${html.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
}

async function awaitProse(
  ctx: Context,
  chatId: number,
  messageId: number,
  readingId: string,
  initial: DailyResponse,
): Promise<void> {
  if (polling.has(readingId)) return
  polling.add(readingId)

  let latest = initial
  const deadline = Date.now() + config.pollTimeoutMs

  try {
    while (Date.now() < deadline) {
      await sleep(config.pollIntervalMs)

      try {
        latest = await pollDaily(readingId)
      } catch (err) {
        // A blip on one poll is not worth giving up on; the deadline bounds us.
        console.warn('[daily] poll error', err)
        continue
      }

      if (latest.status === 'ready' && latest.text) {
        const keyboard = feedbackKeyboard(readingId)
        const full = renderFull(latest)
        if (full) {
          await ctx.api.editMessageText(chatId, messageId, full, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          })
        } else {
          // Too long for one message: keep the facts where they are and send
          // the prose after them rather than cutting the reading short.
          await ctx.api.editMessageText(chatId, messageId, renderFacts(latest), {
            parse_mode: 'HTML',
          })
          await ctx.api.sendMessage(chatId, clip(renderProse(latest.text)), {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          })
        }
        return
      }

      if (latest.status === 'failed') {
        await ctx.api.editMessageText(
          chatId,
          messageId,
          `${renderFacts(latest)}\n\n${FAILED_NOTE}`,
          { parse_mode: 'HTML' },
        )
        return
      }
    }

    await ctx.api.editMessageText(
      chatId,
      messageId,
      `${renderFacts(latest)}\n\n${TIMEOUT_NOTE}`,
      { parse_mode: 'HTML' },
    )
  } finally {
    polling.delete(initial.id)
  }
}
