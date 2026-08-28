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
import { NO_HOUSES_NOTE, renderAreas, renderInlineBrief, renderInlineMain, stripTags } from './format'
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

/**
 * Request budget for an inline query — much tighter than the bot's normal
 * timeout. Telegram closes the inline window in seconds, and an answer that
 * misses it is worse than a fast failure: the picker spins with nothing in it
 * and the user never learns why.
 */
const INLINE_API_TIMEOUT_MS = 4_000

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

/**
 * Answer with nothing to send, but a visible button into the bot.
 *
 * An empty result list on its own is indistinguishable, in the client, from
 * "still loading" — the picker just sits there. The button is what turns a
 * dead end into something the user can act on.
 */
function answerWithButton(ctx: Context, text: string): Promise<true> {
  return ctx.answerInlineQuery([], {
    is_personal: true,
    cache_time: 0,
    button: { text, start_parameter: 'setup' },
  })
}

export async function handleInlineQuery(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id
  if (!telegramId) return

  try {
    let reading = recall(telegramId)

    if (!reading) {
      try {
        // generate:false — a keystroke must not decide who gets the GPU.
        // The short timeout matters more than the answer: Telegram closes the
        // inline window in seconds, and an answer that arrives after that
        // leaves the user watching a spinner that never resolves.
        reading = await fetchDaily(telegramId, {
          generate: false,
          timeoutMs: INLINE_API_TIMEOUT_MS,
        })
        remember(telegramId, reading)
      } catch (err) {
        if (err instanceof NeedsProfileError) {
          await answerWithButton(ctx, 'Заполнить данные')
          return
        }
        console.error('[inline] request failed', err)
        await answerWithButton(ctx, 'Прогноз недоступен — открыть бота')
        return
      }
    }

    const header = renderInlineBrief(reading)
    const main = renderInlineMain(reading)

    const results: InlineQueryResult[] = []

    const scorecard = renderAreas(reading)
    if (scorecard) {
      const note = reading.forecast?.houses_known === false ? `\n\n${NO_HOUSES_NOTE}` : ''
      results.push(article('areas', '✦ Оценка дня по сферам', `${header}\n\n${scorecard}${note}`))
    }

    // Only offer the timeline when it actually says more than its own header.
    if (main !== header) {
      results.push(article('main', '✦ Главное за день', main))
    }
    // Never answer with nothing to send: an empty picker is indistinguishable
    // from a broken one.
    if (results.length === 0) {
      results.push(article('brief', '✦ Коротко о дне', header))
    }

    await ctx.answerInlineQuery(results, {
      // Without this, Telegram may serve one user's forecast to another.
      is_personal: true,
      cache_time: TELEGRAM_CACHE_SECONDS,
    })
  } catch (err) {
    // Every path out of here must answer. An inline query left unanswered is
    // the one failure the user cannot even see — the picker spins forever.
    console.error('[inline] unhandled', err)
    await answerWithButton(ctx, 'Прогноз недоступен — открыть бота').catch(() => {})
  }
}
