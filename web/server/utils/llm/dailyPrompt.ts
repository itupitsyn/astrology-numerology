/**
 * Builds the chat prompt for a daily forecast from already computed data.
 *
 * Very little formatting happens here: astro-service already ranked the day's
 * findings and phrased each one in Russian, so this module's job is to hand the
 * model a short, ordered brief rather than a dump of every aspect. That split is
 * deliberate — a model given eighty aspects writes mush, a model given the five
 * that scored highest writes something specific.
 */

import type { DailyForecast, Highlight } from '../astro/daily'
import type { NumerologyResult } from '../numerology/types'
import type { ChatMessage } from './client'

/**
 * Bump whenever the system prompt or the brief's formatting changes
 * meaningfully. Stored with each reading so A/B comparisons stay honest.
 */
export const DAILY_PROMPT_VERSION = 'daily-v2-birthtime'

const PLANET_RU: Record<string, string> = {
  Sun: 'Солнце', Moon: 'Луна', Mercury: 'Меркурий', Venus: 'Венера',
  Mars: 'Марс', Jupiter: 'Юпитер', Saturn: 'Сатурн', Uranus: 'Уран',
  Neptune: 'Нептун', Pluto: 'Плутон',
}

const SIGN_RU: Record<string, string> = {
  Ari: 'Овен', Tau: 'Телец', Gem: 'Близнецы', Can: 'Рак',
  Leo: 'Лев', Vir: 'Дева', Lib: 'Весы', Sco: 'Скорпион',
  Sag: 'Стрелец', Cap: 'Козерог', Aqu: 'Водолей', Pis: 'Рыбы',
}

/** Strip the date half of an ISO local timestamp: "2026-08-25T14:04" -> "14:04". */
const at = (iso?: string | null) => (iso ? iso.slice(11) : null)

function moonBlock(forecast: DailyForecast): string {
  const moon = forecast.moon
  const house = moon.natal_house == null ? '' : `, ${moon.natal_house} натальный дом`
  const lines = [
    `Луна: ${SIGN_RU[moon.sign] ?? moon.sign}, ${moon.phase_name}, ` +
      `освещённость ${Math.round(moon.illumination * 100)}%, ` +
      `${moon.waxing ? 'растущая' : 'убывающая'}${house}`,
  ]
  if (moon.sign_at_day_start !== moon.sign_at_day_end) {
    lines.push(
      `  за сутки Луна переходит из знака ${SIGN_RU[moon.sign_at_day_start]} ` +
        `в ${SIGN_RU[moon.sign_at_day_end]}`,
    )
  }
  for (const period of moon.void_of_course) {
    const from = period.starts_before_day ? `${at(period.start_local)} (со вчера)` : at(period.start_local)
    const to = period.ends_after_day ? `${at(period.end_local)} (за полночь)` : at(period.end_local)
    lines.push(`  Луна без курса: с ${from} до ${to}`)
  }
  return lines.join('\n')
}

function highlightLine(item: Highlight): string {
  const time = at(item.time_local)
  const when = time ? ` [${time}]` : ''
  return `  • ${item.title}${when} — ${item.detail}`
}

function eventsBlock(forecast: DailyForecast): string | null {
  if (forecast.events.length === 0) return null
  const lines = forecast.events.map((event) => {
    const time = at(event.time_local)
    if (event.kind === 'ingress') {
      return `  • ${time} — ${PLANET_RU[event.planet!] ?? event.planet} переходит в знак ` +
        `${SIGN_RU[event.to_sign!] ?? event.to_sign}`
    }
    if (event.kind === 'station') {
      return `  • ${time} — ${PLANET_RU[event.planet!] ?? event.planet} становится ` +
        `${event.retrograde ? 'ретроградным' : 'директным'}`
    }
    return `  • ${time} — ${event.phase} в знаке ${SIGN_RU[event.sign!] ?? event.sign}`
  })
  return `СОБЫТИЯ СУТОК (местное время):\n${lines.join('\n')}`
}

function numerologyBlock(numerology: NumerologyResult): string {
  const lines = [
    `  • Личный день: ${numerology.personalDay?.value ?? '—'}`,
    `  • Личный месяц: ${numerology.personalMonth?.value ?? '—'}`,
    `  • Личный год: ${numerology.personalYear.value}`,
    `  • Число жизненного пути: ${numerology.lifePath.value}` +
      (numerology.lifePath.isMaster ? ' (мастер-число)' : ''),
  ]
  return `НУМЕРОЛОГИЯ ДНЯ:\n${lines.join('\n')}`
}

const SYSTEM_PROMPT = `Ты — опытный астролог с тёплым, спокойным стилем. Составь прогноз на СЕГОДНЯ по предоставленным расчётным данным.

Правила:
- Опирайся ТОЛЬКО на приведённые данные. Не выдумывай аспекты, положения планет, события и числа, которых нет в брифе.
- Данные уже отранжированы по важности. Главное — блок «ГЛАВНОЕ ЗА ДЕНЬ»: разбери именно его, в том же порядке. Остальные блоки используй как контекст.
- Различай два слоя. Пометка «фон» — это медленный транзит, который держится неделями и месяцами: упомяни его максимум одной фразой как общий период, НИКОГДА не подавай как новость дня. Всё остальное — собственно сегодняшний день.
- Обязательно называй КОНКРЕТНОЕ ВРЕМЯ, когда оно указано в квадратных скобках. «Ближе к 14:00» полезнее, чем «во второй половине дня».
- Если Луна без курса — обязательно скажи об этом и о том, что в это окно лучше не начинать новое и не подписывать важное.
- Свяжи личный день (нумерология) с астрологической картиной, а не приводи их двумя отдельными списками.
- Структура ответа:
  1. Одно-два предложения: общий тон дня.
  2. Что именно происходит и когда (по главным пунктам, со временем).
  3. На что обратить внимание / чего лучше не делать сегодня.
  4. Один короткий практический совет.
- Без фатализма и запугивания. Никаких медицинских, юридических и финансовых гарантий и рекомендаций.
- Пиши СТРОГО на русском языке, без вставок слов или иероглифов на других языках.
- Объём — 200-350 слов. Это сообщение в мессенджере, а не статья. Без Markdown-заголовков, короткими абзацами.`

export interface DailyPromptInput {
  forecast: DailyForecast
  numerology: NumerologyResult
  subjectName?: string | null
  city?: string | null
  /** Optional thematic focus, e.g. "работа". */
  focus?: string | null
}

export function buildDailyPrompt(input: DailyPromptInput): ChatMessage[] {
  const { forecast, numerology, subjectName, city, focus } = input

  const background = forecast.highlights.filter((h) => h.layer === 'background')
  const today = forecast.highlights.filter((h) => h.layer === 'today')

  const parts = [
    subjectName ? `Имя: ${subjectName}` : null,
    `Дата: ${forecast.date}`,
    city ? `Место: ${city}` : null,
    `Часовой пояс: ${forecast.timezone} (всё время ниже — местное)`,
    // Stated rather than left implicit: otherwise a model happily writes about
    // "your tenth house" from a chart that has no houses in it at all.
    forecast.houses_known
      ? null
      : 'ВРЕМЯ РОЖДЕНИЯ НЕИЗВЕСТНО: дома и Асцендент не рассчитаны. Не упоминай дома, Асцендент и MC — их в данных нет.',
    '',
    moonBlock(forecast),
    '',
    'ГЛАВНОЕ ЗА ДЕНЬ (в порядке важности):',
    ...(today.length > 0 ? today.map(highlightLine) : ['  • день без выраженных событий']),
    background.length > 0
      ? `\nОБЩИЙ ПЕРИОД (фон, держится неделями — только контекст):\n${background.map(highlightLine).join('\n')}`
      : null,
    '',
    eventsBlock(forecast),
    forecast.retrogrades.length > 0
      ? `РЕТРОГРАДНЫЕ ПЛАНЕТЫ: ${forecast.retrogrades.map((p) => PLANET_RU[p] ?? p).join(', ')}`
      : null,
    '',
    numerologyBlock(numerology),
    focus ? `\nОсобый фокус: ${focus}.` : null,
  ].filter((part): part is string => part !== null)

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ]
}
