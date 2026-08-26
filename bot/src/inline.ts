/**
 * Inline mode: `@bot` in any chat, and the day's forecast can be dropped in.
 *
 * Three constraints shape this file.
 *
 * 1. **Telegram fires an inline query on every keystroke.** So the request path
 *    must cause no work: `generate: false` means no slot claimed, no model run,
 *    nothing written. A short per-user memo keeps the astro-service round trip
 *    off most of those keystrokes too.
 *
 * 2. **The answer must be immediate**, well inside Telegram's few seconds. That
 *    rules out the prose entirely — which suits the brief, since a wall of text
 *    pasted into someone else's chat is exactly the spam to avoid. Inline sends
 *    facts only.
 *
 * 3. **Results are per-user and must never be cached across users.**
 *    `is_personal: true` is what tells Telegram that; without it one person's
 *    natal forecast could be served to somebody else typing the same query.
 */

import type { InlineQueryResult } from 'grammy/types'
import type { Context } from 'grammy'
import { NeedsProfileError, fetchDaily } from './api'
import { renderInlineBrief, renderInlineMain, stripTags } from './format'
import type { DailyResponse } from './types'

/**
 * How long a user's facts are reused across their own keystrokes.
 *
 * Safe to keep generous: inline shows only the day's facts, and those do not
 * change during the day. It exists to stop one typed word from becoming ten
 * identical computations.
 */
const MEMO_TTL_MS = 120_000

/** How long Telegram may cache a result. Personal, so never shared across users. */
const TELEGRAM_CACHE_SECONDS = 30

interface Memo {
  reading: DailyResponse
  expires: number
}

const memo = new Map<number, Memo>()

function remember(telegramId: number, reading: DailyResponse): void {
  memo.set(telegramId, { reading, expires: Date.now() + MEMO_TTL_MS })
}

function recall(telegramId: number): DailyResponse | null {
  const hit = memo.get(telegramId)
  if (!hit) return null
  if (hit.expires < Date.now()) {
    memo.delete(telegramId)
    return null
  }
  return hit.reading
}

/** Drop a user's memo — after a profile edit their facts are stale. */
export function forgetInlineCache(telegramId: number): void {
  memo.delete(telegramId)
}

function article(id: string, title: string, html: string): InlineQueryResult {
  return {
    type: 'article',
    id,
    title,
    description: stripTags(html).slice(0, 120),
    input_message_content: {
      message_text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    },
  }
}

export async function handleInlineQuery(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  if (!telegramId) return

  let reading = recall(telegramId)

  if (!reading) {
    try {
      // generate:false — a keystroke must not decide who gets the GPU.
      reading = await fetchDaily(telegramId, { generate: false })
      remember(telegramId, reading)
    } catch (err) {
      if (err instanceof NeedsProfileError) {
        // No data yet: offer nothing to send, and a button into the bot.
        await ctx.answerInlineQuery([], {
          is_personal: true,
          cache_time: 0,
          button: { text: 'Заполнить данные', start_parameter: 'setup' },
        })
        return
      }
      console.error('[inline] failed', err)
      await ctx.answerInlineQuery([], { is_personal: true, cache_time: 0 })
      return
    }
  }

  const brief = renderInlineBrief(reading)
  const main = renderInlineMain(reading)

  const results: InlineQueryResult[] = [article('brief', '✦ Кратко — одна строка', brief)]

  // Only offer the longer variant when it actually says more.
  if (main !== brief) {
    results.push(article('main', '✦ Главное за день', main))
  }

  await ctx.answerInlineQuery(results, {
    // Without this, Telegram may serve one user's forecast to another.
    is_personal: true,
    cache_time: TELEGRAM_CACHE_SECONDS,
  })
}
