/**
 * Rendering the API's data into Telegram messages.
 *
 * HTML parse mode throughout, with everything dynamic escaped. MarkdownV2 would
 * mean escaping a dozen characters inside model-written prose, where a single
 * stray underscore turns the whole message into an API error.
 */

import type { DailyResponse, Highlight, VoidOfCourse } from './types'

/** Telegram's hard limit for a message. */
export const MAX_MESSAGE_LENGTH = 4096

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

const PLANET_RU: Record<string, string> = {
  Sun: 'Солнце', Moon: 'Луна', Mercury: 'Меркурий', Venus: 'Венера',
  Mars: 'Марс', Jupiter: 'Юпитер', Saturn: 'Сатурн', Uranus: 'Уран',
  Neptune: 'Нептун', Pluto: 'Плутон',
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** "2026-08-26" -> "26 августа". */
export function formatDateRu(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const month = MONTHS_RU[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month}` : date
}

/** "2026-08-26T14:04" -> "14:04". */
const at = (iso?: string | null) => (iso ? iso.slice(11, 16) : null)

function voidLine(period: VoidOfCourse): string {
  const from = period.starts_before_day ? 'с ночи' : `с ${at(period.start_local)}`
  const to = period.ends_after_day ? 'до конца суток' : `до ${at(period.end_local)}`
  return `⚠️ Луна без курса ${from} ${to} — не лучшее время начинать новое`
}

function highlightLine(item: Highlight): string {
  const time = at(item.time_local)
  const prefix = time ? `<b>${time}</b> · ` : ''
  return `• ${prefix}${escapeHtml(item.title)}`
}

/**
 * The instant half of the answer: everything computed without a GPU.
 *
 * Sent on its own within milliseconds, so a user always gets something real
 * even when the model is slow or down.
 */
export function renderFacts(response: DailyResponse): string {
  const forecast = response.forecast
  const lines: string[] = [`<b>✦ ${escapeHtml(formatDateRu(response.date))}</b>`]

  if (!forecast) return lines.join('\n')

  const moon = forecast.moon
  const house = moon.natal_house == null ? '' : `, ${moon.natal_house} дом`
  lines.push(
    `🌙 Луна — ${escapeHtml(moon.sign_ru)}, ${escapeHtml(moon.phase_name.toLowerCase())}, ` +
      `${Math.round(moon.illumination * 100)}%${house}`,
  )

  const day = response.numerology?.personalDay?.value
  if (day != null) lines.push(`🔢 Личный день — ${day}`)

  for (const period of moon.void_of_course) lines.push(voidLine(period))

  const today = forecast.highlights.filter((h) => h.layer === 'today')
  const background = forecast.highlights.filter((h) => h.layer === 'background')

  if (today.length > 0) {
    lines.push('', '<b>Главное за день</b>')
    lines.push(...today.map(highlightLine))
  }
  if (background.length > 0) {
    lines.push('', '<i>Общий период:</i>')
    lines.push(...background.map((h) => `• ${escapeHtml(h.title)}`))
  }

  if (forecast.retrogrades.length > 0) {
    const names = forecast.retrogrades.map((p) => PLANET_RU[p] ?? p).join(', ')
    lines.push('', `↩️ Ретроградны: ${escapeHtml(names)}`)
  }

  if (!forecast.houses_known) {
    lines.push('', '<i>Время рождения не указано, поэтому дома и Асцендент не учитываются.</i>')
  }

  return lines.join('\n')
}

/**
 * Model-written prose.
 *
 * Escaped first, then the one markup habit models cannot be talked out of
 * (`**bold**`) is converted, so it renders instead of showing as asterisks.
 */
export function renderProse(text: string): string {
  return escapeHtml(text.trim()).replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
}

/**
 * One line, for pasting into someone else's chat.
 *
 * Inline results land in conversations that did not ask for them, so this is
 * deliberately the smallest thing that is still worth reading: the date, the
 * Moon, the personal day — and a void-of-course window only when there is one,
 * because that is the single piece of the day that is actionable.
 */
export function renderInlineBrief(response: DailyResponse): string {
  const forecast = response.forecast
  const parts = [`✦ <b>${escapeHtml(formatDateRu(response.date))}</b>`]

  if (forecast) {
    const moon = forecast.moon
    parts.push(
      `🌙 ${escapeHtml(moon.sign_ru)}, ${escapeHtml(moon.phase_name.toLowerCase())} ` +
        `${Math.round(moon.illumination * 100)}%`,
    )
  }
  const day = response.numerology?.personalDay?.value
  if (day != null) parts.push(`🔢 личный день ${day}`)

  const lines = [parts.join(' · ')]
  for (const period of forecast?.moon.void_of_course ?? []) lines.push(voidLine(period))
  return lines.join('\n')
}

/** How many findings the medium inline result carries. */
export const INLINE_HIGHLIGHTS = 3

/** The brief line plus the few findings that actually distinguish the day. */
export function renderInlineMain(response: DailyResponse): string {
  const today = (response.forecast?.highlights ?? []).filter((h) => h.layer === 'today')
  const lines = [renderInlineBrief(response)]
  if (today.length > 0) {
    lines.push('', ...today.slice(0, INLINE_HIGHLIGHTS).map(highlightLine))
  }
  return lines.join('\n')
}

/** Plain-text preview for the inline picker, which renders no markup. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export const GENERATING_NOTE = '<i>✍️ Пишу разбор…</i>'

export const FAILED_NOTE =
  '<i>Разбор словами сейчас не получился — расчёт выше верный. Попробуйте /today чуть позже.</i>'

export const TIMEOUT_NOTE =
  '<i>Разбор словами всё ещё готовится. Загляните через несколько минут — /today.</i>'

/**
 * Facts plus prose, or null when the two together exceed what Telegram accepts.
 *
 * Callers fall back to sending the prose as its own message: silently truncating
 * a reading would be worse than splitting it.
 */
export function renderFull(response: DailyResponse): string | null {
  const combined = `${renderFacts(response)}\n\n${renderProse(response.text ?? '')}`
  return combined.length <= MAX_MESSAGE_LENGTH ? combined : null
}
