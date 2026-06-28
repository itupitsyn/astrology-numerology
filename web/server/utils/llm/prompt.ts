/**
 * Builds the chat prompt for an astro-numerology interpretation from already
 * computed data (natal chart + numerology). No astrology is computed here.
 */

import type { Aspect, CelestialPoint, NatalChart } from '../astro/types'
import type { NumerologyNumber, NumerologyResult } from '../numerology/types'
import type { ChatMessage } from './client'

/**
 * Bump this whenever the system prompt / data formatting changes meaningfully.
 * Stored with each reading so model/prompt A/B comparisons stay apples-to-apples.
 */
export const PROMPT_VERSION = 'v2-orbs-config-moon'

const SIGN_RU: Record<string, string> = {
  Ari: 'Овен', Tau: 'Телец', Gem: 'Близнецы', Can: 'Рак',
  Leo: 'Лев', Vir: 'Дева', Lib: 'Весы', Sco: 'Скорпион',
  Sag: 'Стрелец', Cap: 'Козерог', Aqu: 'Водолей', Pis: 'Рыбы',
}

const POINT_RU: Record<string, string> = {
  Sun: 'Солнце', Moon: 'Луна', Mercury: 'Меркурий', Venus: 'Венера',
  Mars: 'Марс', Jupiter: 'Юпитер', Saturn: 'Сатурн', Uranus: 'Уран',
  Neptune: 'Нептун', Pluto: 'Плутон',
  Mean_Node: 'Восходящий узел (Раху)', True_Node: 'Восходящий узел (истинный)',
  Mean_South_Node: 'Нисходящий узел (Кету)', True_South_Node: 'Нисходящий узел (истинный)',
  Chiron: 'Хирон', Mean_Lilith: 'Лилит (Чёрная Луна)',
  Ascendant: 'Асцендент', Medium_Coeli: 'MC (Середина неба)',
  Descendant: 'Десцендент', Imum_Coeli: 'IC (Надир)',
}

const ASPECT_RU: Record<string, string> = {
  conjunction: 'соединение', opposition: 'оппозиция', trine: 'тригон',
  square: 'квадрат', sextile: 'секстиль', quincunx: 'квинконс',
  semisextile: 'полусекстиль', semisquare: 'полуквадрат', sesquiquadrate: 'полутораквадрат',
}

const HOUSE_NUM: Record<string, number> = {
  First_House: 1, Second_House: 2, Third_House: 3, Fourth_House: 4,
  Fifth_House: 5, Sixth_House: 6, Seventh_House: 7, Eighth_House: 8,
  Ninth_House: 9, Tenth_House: 10, Eleventh_House: 11, Twelfth_House: 12,
}

const ru = (map: Record<string, string>, key: string) => map[key] ?? key
const deg = (n: number) => `${n.toFixed(1)}°`

function formatPoint(p: CelestialPoint): string {
  const parts = [`${ru(POINT_RU, p.name)} — ${ru(SIGN_RU, p.sign)} ${deg(p.position)}`]
  if (p.house && HOUSE_NUM[p.house]) parts.push(`${HOUSE_NUM[p.house]} дом`)
  if (p.retrograde) parts.push('ретроград')
  return parts.join(', ')
}

/** Qualitative strength of an aspect by its orb, to guide the LLM. */
function aspectStrength(orb: number): string {
  const o = Math.abs(orb)
  if (o <= 2) return 'очень точный'
  if (o <= 5) return 'точный'
  return 'широкий'
}

function formatAspect(a: Aspect): string {
  const orb = Math.abs(a.orbit)
  return `${ru(POINT_RU, a.p1_name)} ${ru(ASPECT_RU, a.aspect)} ${ru(POINT_RU, a.p2_name)} (орб ${orb.toFixed(1)}°, ${aspectStrength(a.orbit)})`
}

function formatNumber(label: string, n?: NumerologyNumber): string | null {
  if (!n) return null
  return `${label}: ${n.value}${n.isMaster ? ' (мастер-число)' : ''}`
}

function chartBlock(chart: NatalChart): string {
  const lines: string[] = []
  lines.push('ПЛАНЕТЫ И ТОЧКИ:')
  for (const p of chart.planets) lines.push(`  • ${formatPoint(p)}`)
  lines.push('ОСИ КАРТЫ:')
  for (const a of chart.axes) lines.push(`  • ${formatPoint(a)}`)
  if (chart.lunar_phase?.moon_phase_name) {
    lines.push(`ФАЗА ЛУНЫ: ${chart.lunar_phase.moon_phase_name}`)
  }
  lines.push('ОСНОВНЫЕ АСПЕКТЫ:')
  for (const a of chart.aspects) lines.push(`  • ${formatAspect(a)}`)
  return lines.join('\n')
}

function numerologyBlock(num: NumerologyResult): string {
  const lines = [
    formatNumber('Число жизненного пути', num.lifePath),
    formatNumber('Число дня рождения', num.birthday),
    formatNumber('Число выражения (судьбы)', num.expression),
    formatNumber('Число души', num.soulUrge),
    formatNumber('Число личности', num.personality),
    formatNumber('Число зрелости', num.maturity),
    formatNumber(`Личный год (${num.meta.targetYear})`, num.personalYear),
  ].filter((l): l is string => l !== null)
  return lines.map((l) => `  • ${l}`).join('\n')
}

const SYSTEM_PROMPT = `Ты — опытный астролог и нумеролог с тёплым, поддерживающим стилем.
На основе ПРЕДОСТАВЛЕННЫХ расчётных данных (натальная карта и нумерологические числа) составь цельную интерпретацию на русском языке.

Правила:
- Опирайся ТОЛЬКО на приведённые данные. Не выдумывай положения планет, аспекты или числа, которых нет в данных.
- Учитывай орбы аспектов. Делай акцент на аспектах с пометкой «очень точный» и «точный» — это каркас личности. Аспекты с пометкой «широкий» упоминай осторожно и НЕ называй их сильными; широкое соединение (орб больше ~6°) не описывай как тесное «на градусе».
- Если из приведённых аспектов и положений реально складывается мажорная конфигурация (тау-квадрат, большой тригон, стеллиум, йод), назови её и объясни. Не придумывай конфигурации, которых нет.
- Обязательно учти фазу Луны в портрете.
- Синтезируй астрологию и нумерологию вместе как единый портрет, а не двумя раздельными списками.
- Структура ответа:
  1. Краткое тёплое вступление (2-3 предложения).
  2. Ключевые черты личности.
  3. Сильные стороны и зоны роста.
  4. Текущий период (опираясь на личный год).
  5. 2-3 практических совета.
- Тон поддерживающий, без фатализма, без медицинских, юридических и финансовых гарантий.
- Пиши СТРОГО на русском языке, без вставок слов или иероглифов на других языках.
- Пиши живым человеческим языком. Допустимы подзаголовки уровня ## не глубже.`

export interface InterpretationPromptInput {
  chart: NatalChart
  numerology: NumerologyResult
  subjectName?: string
  /** Optional extra focus, e.g. "карьера и финансы". */
  focus?: string
}

export function buildInterpretationPrompt(input: InterpretationPromptInput): ChatMessage[] {
  const { chart, numerology, subjectName, focus } = input

  const userParts = [
    subjectName ? `Имя: ${subjectName}` : null,
    `Дата/время рождения (локальное): ${chart.birth_datetime_local}`,
    `Часовой пояс: ${chart.timezone}`,
    '',
    chartBlock(chart),
    '',
    'НУМЕРОЛОГИЯ:',
    numerologyBlock(numerology),
    focus ? `\nОсобый фокус интерпретации: ${focus}.` : null,
  ].filter((p): p is string => p !== null)

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userParts.join('\n') },
  ]
}
