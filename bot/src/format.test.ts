import { describe, expect, it } from 'vitest'
import {
  INLINE_HIGHLIGHTS,
  MAX_MESSAGE_LENGTH,
  escapeHtml,
  formatDateRu,
  renderFacts,
  renderFull,
  renderInlineBrief,
  renderInlineMain,
  renderProse,
  stripTags,
} from './format'
import type { DailyResponse } from './types'

function reading(overrides: Partial<DailyResponse> = {}): DailyResponse {
  return {
    id: 'abc123',
    status: 'pending',
    date: '2026-08-26',
    timezone: 'Europe/Moscow',
    text: null,
    model: null,
    promptVersion: null,
    error: null,
    numerology: {
      personalDay: { value: 9, isMaster: false },
      personalMonth: { value: 2, isMaster: false },
      personalYear: { value: 3, isMaster: false },
    },
    forecast: {
      date: '2026-08-26',
      timezone: 'Europe/Moscow',
      houses_known: true,
      moon: {
        sign_ru: 'Козерог',
        phase_name: 'Растущая Луна',
        illumination: 0.923,
        waxing: true,
        natal_house: 5,
        void_of_course: [],
      },
      retrogrades: ['Saturn', 'Neptune'],
      events: [],
      highlights: [
        {
          kind: 'natal_aspect',
          layer: 'today',
          score: 2.4,
          title: 'Луна в соединении к натальной Луне',
          detail: 'точный аспект в 11:53',
          time_local: '2026-08-26T11:53',
        },
        {
          kind: 'event',
          layer: 'today',
          score: 1,
          title: 'Меркурий переходит в Деву',
          detail: 'из знака Лев',
          time_local: '2026-08-26T14:04',
        },
      ],
    },
    ...overrides,
  }
}

describe('escapeHtml', () => {
  it('neutralises the characters Telegram parses as markup', () => {
    expect(escapeHtml('<b>x</b> & y')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y')
  })

  it('leaves ordinary Russian text alone', () => {
    expect(escapeHtml('Луна в Козероге, 92%')).toBe('Луна в Козероге, 92%')
  })
})

describe('formatDateRu', () => {
  it('renders a Russian date', () => {
    expect(formatDateRu('2026-08-26')).toBe('26 августа')
    expect(formatDateRu('2026-01-01')).toBe('1 января')
    expect(formatDateRu('2026-12-31')).toBe('31 декабря')
  })

  it('passes anything unexpected through untouched', () => {
    expect(formatDateRu('not-a-date')).toBe('not-a-date')
  })
})

describe('renderFacts', () => {
  it('leads with the date and the Moon', () => {
    const html = renderFacts(reading())
    expect(html).toContain('26 августа')
    expect(html).toContain('🌙 Луна — Козерог, растущая луна, 92%, 5 дом')
  })

  it('includes the personal day', () => {
    expect(renderFacts(reading())).toContain('Личный день — 9')
  })

  it('puts the exact time in front of each highlight', () => {
    const html = renderFacts(reading())
    expect(html).toContain('<b>11:53</b> · Луна в соединении к натальной Луне')
    expect(html).toContain('<b>14:04</b> · Меркурий переходит в Деву')
  })

  it('lists the day in time order, not by score', () => {
    // The API ranks by importance; a list headed by clock times has to read as
    // a schedule, or 07:00 → 03:47 → 01:47 looks broken.
    const base = reading()
    base.forecast!.highlights = [
      { kind: 'natal_aspect', layer: 'today', score: 9, title: 'Поздний', detail: '', time_local: '2026-08-26T19:37' },
      { kind: 'natal_aspect', layer: 'today', score: 5, title: 'Ранний', detail: '', time_local: '2026-08-26T01:47' },
      { kind: 'natal_aspect', layer: 'today', score: 7, title: 'Дневной', detail: '', time_local: '2026-08-26T12:59' },
    ]
    const times = renderFacts(base)
      .split('\n')
      .filter((l) => l.startsWith('•'))
      .map((l) => l.slice(l.indexOf('<b>') + 3, l.indexOf('</b>')))
    expect(times).toEqual(['01:47', '12:59', '19:37'])
  })

  it('puts all-day findings after the timed ones', () => {
    const base = reading()
    base.forecast!.highlights = [
      { kind: 'natal_aspect', layer: 'today', score: 9, title: 'Весь день', detail: '', time_local: null },
      { kind: 'natal_aspect', layer: 'today', score: 1, title: 'В восемь', detail: '', time_local: '2026-08-26T08:00' },
    ]
    const bullets = renderFacts(base).split('\n').filter((l) => l.startsWith('•'))
    expect(bullets[0]).toContain('В восемь')
    expect(bullets[1]).toContain('Весь день')
  })

  it('names retrograde planets in Russian', () => {
    expect(renderFacts(reading())).toContain('Ретроградны: Сатурн, Нептун')
  })

  it('separates the slow background layer from today', () => {
    const base = reading()
    base.forecast!.highlights.push({
      kind: 'natal_aspect',
      layer: 'background',
      score: 0.6,
      title: 'Сатурн в квадрате к натальному Нептуну',
      detail: 'орб 0.3°',
      time_local: null,
    })
    const html = renderFacts(base)
    expect(html).toContain('Главное за день')
    expect(html).toContain('Общий период')
    // A months-long transit must not be dressed up as today's news.
    const todayIndex = html.indexOf('Главное за день')
    expect(html.indexOf('Сатурн в квадрате')).toBeGreaterThan(todayIndex)
  })

  it('warns about a void-of-course Moon with its window', () => {
    const base = reading()
    base.forecast!.moon.void_of_course = [
      {
        start_local: '2026-08-26T09:30',
        end_local: '2026-08-26T12:01',
        starts_before_day: false,
        ends_after_day: false,
      },
    ]
    expect(renderFacts(base)).toContain('Луна без курса с 09:30 до 12:01')
  })

  it('phrases a window that straddles midnight without a bogus time', () => {
    const base = reading()
    base.forecast!.moon.void_of_course = [
      {
        start_local: '2026-08-25T16:30',
        end_local: '2026-08-27T02:00',
        starts_before_day: true,
        ends_after_day: true,
      },
    ]
    const html = renderFacts(base)
    expect(html).toContain('с ночи')
    expect(html).toContain('до конца суток')
  })

  it('says so when the birth time is unknown, and shows no house', () => {
    const base = reading()
    base.forecast!.houses_known = false
    base.forecast!.moon.natal_house = null
    const html = renderFacts(base)
    expect(html).toContain('Время рождения не указано')
    // No house may be claimed on the Moon line. (Checked on that line alone:
    // the disclaimer itself contains the word "дома".)
    const moonLine = html.split('\n').find((line) => line.startsWith('🌙'))!
    expect(moonLine).not.toMatch(/\d+ дом/)
  })

  it('survives a reading whose facts are missing', () => {
    // Should never happen, but a crash in the formatter would cost the user the
    // whole answer.
    const html = renderFacts(reading({ forecast: null, numerology: null }))
    expect(html).toContain('26 августа')
  })

  it('escapes anything the API supplied', () => {
    const base = reading()
    base.forecast!.highlights[0]!.title = 'Луна <b> & Солнце'
    expect(renderFacts(base)).toContain('Луна &lt;b&gt; &amp; Солнце')
  })
})

describe('renderProse', () => {
  it('escapes model output', () => {
    expect(renderProse('a < b & c')).toBe('a &lt; b &amp; c')
  })

  it('converts the bold models insist on writing', () => {
    expect(renderProse('Сегодня **важный** день')).toBe('Сегодня <b>важный</b> день')
  })

  it('spans line breaks inside bold', () => {
    expect(renderProse('**две\nстроки**')).toBe('<b>две\nстроки</b>')
  })

  it('trims surrounding whitespace', () => {
    expect(renderProse('\n\n  текст  \n')).toBe('текст')
  })
})

describe('renderInlineBrief', () => {
  it('fits on one line', () => {
    const html = renderInlineBrief(reading())
    expect(html.split('\n')).toHaveLength(1)
    expect(html).toContain('26 августа')
    expect(html).toContain('Козерог')
    expect(html).toContain('личный день 9')
  })

  it('stays short enough not to read as spam in someone else\'s chat', () => {
    expect(stripTags(renderInlineBrief(reading())).length).toBeLessThan(120)
  })

  it('adds the void-of-course window, the one actionable thing', () => {
    const base = reading()
    base.forecast!.moon.void_of_course = [
      {
        start_local: '2026-08-26T09:30',
        end_local: '2026-08-26T12:01',
        starts_before_day: false,
        ends_after_day: false,
      },
    ]
    const html = renderInlineBrief(base)
    expect(html.split('\n')).toHaveLength(2)
    expect(html).toContain('без курса')
  })

  it('never carries the prose, however ready it is', () => {
    const html = renderInlineBrief(reading({ status: 'ready', text: 'Длинный разбор дня…' }))
    expect(html).not.toContain('Длинный разбор')
  })
})

describe('renderInlineMain', () => {
  it('adds a few findings but stays well under a screenful', () => {
    const html = renderInlineMain(reading())
    expect(html).toContain('11:53')
    expect(stripTags(html).length).toBeLessThan(400)
  })

  it('selects by score but shows them in time order', () => {
    // Both halves matter: the low-scoring 02:00 item must not crowd out a
    // high-scoring one, and what survives must still read forwards.
    const base = reading()
    base.forecast!.highlights = [
      { kind: 'natal_aspect', layer: 'today', score: 9, title: 'Важное вечером', detail: '', time_local: '2026-08-26T20:00' },
      { kind: 'natal_aspect', layer: 'today', score: 8, title: 'Важное днём', detail: '', time_local: '2026-08-26T13:00' },
      { kind: 'natal_aspect', layer: 'today', score: 7, title: 'Важное утром', detail: '', time_local: '2026-08-26T09:00' },
      { kind: 'natal_aspect', layer: 'today', score: 0.1, title: 'Мелочь ночью', detail: '', time_local: '2026-08-26T02:00' },
    ]
    const bullets = renderInlineMain(base).split('\n').filter((l) => l.startsWith('•'))
    expect(bullets).toHaveLength(3)
    expect(bullets.join('\n')).not.toContain('Мелочь ночью')
    expect(bullets[0]).toContain('Важное утром')
    expect(bullets[2]).toContain('Важное вечером')
  })

  it('caps the number of findings', () => {
    const base = reading()
    for (let i = 0; i < 10; i++) {
      base.forecast!.highlights.push({
        kind: 'natal_aspect',
        layer: 'today',
        score: 1,
        title: `Событие ${i}`,
        detail: '',
        time_local: null,
      })
    }
    const bullets = renderInlineMain(base).split('\n').filter((l) => l.startsWith('•'))
    expect(bullets).toHaveLength(INLINE_HIGHLIGHTS)
  })

  it('leaves out the slow background layer entirely', () => {
    const base = reading()
    base.forecast!.highlights = [
      {
        kind: 'natal_aspect',
        layer: 'background',
        score: 5,
        title: 'Плутон в квадрате к натальному Солнцу',
        detail: '',
        time_local: null,
      },
    ]
    // A two-year transit is the opposite of news; in a one-line message it is
    // pure noise.
    expect(renderInlineMain(base)).not.toContain('Плутон')
  })

  it('collapses to the brief line when there is nothing to add', () => {
    const base = reading()
    base.forecast!.highlights = []
    expect(renderInlineMain(base)).toBe(renderInlineBrief(base))
  })
})

describe('stripTags', () => {
  it('produces a plain-text preview', () => {
    expect(stripTags('<b>11:53</b> · Луна &amp; Солнце')).toBe('11:53 · Луна & Солнце')
  })

  it('collapses newlines so a preview stays one line', () => {
    expect(stripTags('первая\nвторая')).toBe('первая вторая')
  })
})

describe('renderFull', () => {
  it('joins facts and prose when they fit', () => {
    const html = renderFull(reading({ status: 'ready', text: '短 текст дня.' }))
    expect(html).not.toBeNull()
    expect(html).toContain('26 августа')
    expect(html).toContain('текст дня')
  })

  it('refuses instead of truncating when the two exceed the limit', () => {
    // Silently cutting a reading in half is worse than sending two messages.
    const long = 'а'.repeat(MAX_MESSAGE_LENGTH)
    expect(renderFull(reading({ status: 'ready', text: long }))).toBeNull()
  })
})
