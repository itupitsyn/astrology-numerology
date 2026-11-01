import { describe, expect, it } from 'vitest'
import type { SkyForecast } from '../astro/daily'
import { buildSkyPrompt } from './skyPrompt'

const forecast = {
  date: '2026-11-01',
  timezone: 'Europe/Moscow',
  moon: {
    sign: 'Can',
    sign_at_day_start: 'Can',
    sign_at_day_end: 'Can',
    phase_name: 'Убывающая',
    illumination: 0.6,
    waxing: false,
    natal_house: null,
    void_of_course: [
      { start_local: '2026-11-01T14:20', end_local: '2026-11-01T18:05', starts_before_day: false, ends_after_day: false },
    ],
  },
  retrogrades: ['Saturn'],
  events: [],
  highlights: [
    { kind: 'event', layer: 'today', score: 5, title: 'Луна без курса', detail: 'с 14:20 до 18:05', meaning: 'Не время начинать новое.', time_local: '2026-11-01T14:20', data: {} },
    { kind: 'sky_aspect', layer: 'background', score: 2, title: 'Сатурн в трине', detail: 'фон', meaning: 'Период выдержки.', time_local: null, data: {} },
  ],
} as unknown as SkyForecast

describe('buildSkyPrompt', () => {
  it('hands over the timed findings and the void of course', () => {
    const brief = buildSkyPrompt(forecast)[1]!.content as string
    expect(brief).toContain('[14:20] Не время начинать новое.')
    expect(brief).toContain('Луна без курса: с 14:20 до 18:05')
    expect(brief).toContain('ОБЩИЙ ПЕРИОД')
    expect(brief).toContain('Дата: 1 ноября')
  })

  it('has no person in the brief', () => {
    const brief = buildSkyPrompt(forecast)[1]!.content as string
    expect(brief).not.toMatch(/Имя:|НУМЕРОЛОГИЯ|натальн/i)
  })
})
