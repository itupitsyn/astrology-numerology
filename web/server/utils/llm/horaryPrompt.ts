/**
 * Builds the chat prompt for a horary interpretation.
 *
 * The verdict (yes/no/qualified), timing and every judgment factor are computed
 * deterministically by astro-service (horary.py). The LLM's ONLY job is to
 * narrate that already-decided result in warm, plain Russian. The system prompt
 * forbids the model from changing the verdict — it must not invent a different
 * yes/no than the one in `judgment.verdict`.
 */

import type {
  AspectHit,
  DignityInfo,
  HoraryChart,
  Significator,
} from '../astro/types'
import { HOUSE_MEANINGS_RU } from '../../../shared/horary'
import type { ChatMessage } from './client'

/** Bump when the system prompt / data formatting changes meaningfully. */
export const HORARY_PROMPT_VERSION = 'horary-v1'

const PLANET_RU: Record<string, string> = {
  Sun: 'Солнце', Moon: 'Луна', Mercury: 'Меркурий', Venus: 'Венера',
  Mars: 'Марс', Jupiter: 'Юпитер', Saturn: 'Сатурн',
}

const SIGN_RU: Record<string, string> = {
  Ari: 'Овен', Tau: 'Телец', Gem: 'Близнецы', Can: 'Рак',
  Leo: 'Лев', Vir: 'Дева', Lib: 'Весы', Sco: 'Скорпион',
  Sag: 'Стрелец', Cap: 'Козерог', Aqu: 'Водолей', Pis: 'Рыбы',
}

const ASPECT_RU: Record<string, string> = {
  conjunction: 'соединение', sextile: 'секстиль', square: 'квадрат',
  trine: 'тригон', opposition: 'оппозиция',
}

const VERDICT_RU: Record<string, string> = {
  yes: 'ДА',
  no: 'НЕТ',
  qualified: 'ДА, НО С УСЛОВИЯМИ',
}

const DIGNITY_LABELS: Array<[keyof DignityInfo, string]> = [
  ['domicile', 'обитель'],
  ['exaltation', 'экзальтация'],
  ['triplicity', 'триплицитет'],
  ['term', 'термин'],
  ['face', 'лик'],
]
const DEBILITY_LABELS: Array<[keyof DignityInfo, string]> = [
  ['detriment', 'изгнание'],
  ['fall', 'падение'],
]

const ru = (map: Record<string, string>, key: string) => map[key] ?? key
const deg = (n: number) => `${n.toFixed(1)}°`

function dignitySummary(d: DignityInfo): string {
  const strengths = DIGNITY_LABELS.filter(([k]) => d[k]).map(([, label]) => label)
  const weaknesses = DEBILITY_LABELS.filter(([k]) => d[k]).map(([, label]) => label)
  if (d.peregrine && weaknesses.length === 0) weaknesses.push('перегрин (без достоинств)')
  const parts: string[] = []
  if (strengths.length) parts.push(`достоинства: ${strengths.join(', ')}`)
  if (weaknesses.length) parts.push(`слабости: ${weaknesses.join(', ')}`)
  parts.push(`балл ${d.score >= 0 ? '+' : ''}${d.score}`)
  return parts.join('; ')
}

function significatorBlock(role: string, s: Significator): string {
  const lines = [
    `${role} — ${s.house}-й дом, управитель ${ru(PLANET_RU, s.planet)}:`,
    `  • положение: ${ru(SIGN_RU, s.sign)} ${deg(s.position)}` +
      (s.house_of_planet ? `, в ${s.house_of_planet}-м доме` : '') +
      (s.retrograde ? ', ретроградный' : ''),
    `  • ${dignitySummary(s.dignity)}`,
  ]
  return lines.join('\n')
}

function aspectPhrase(a: AspectHit): string {
  const kind = a.applying ? 'применительный (сходится)' : 'сепарационный (расходится)'
  const perf = a.applying
    ? (a.perfects_before_sign_exit ? ', перфектируется до смены знака' : ', НЕ успевает перфектироваться (смена знака)')
    : ''
  const to = a.degrees_to_perfect != null ? `, ${deg(a.degrees_to_perfect)} до точного` : ''
  return `${ru(PLANET_RU, a.p1)} ${ru(ASPECT_RU, a.aspect)} ${ru(PLANET_RU, a.p2)} — ${kind}${to}${perf}`
}

function moonBlock(chart: HoraryChart): string {
  const m = chart.moon
  const lines = ['ЛУНА (со-сигнификатор и «мотор» карты):']
  lines.push(`  • без курса (void of course): ${m.void_of_course ? 'ДА' : 'нет'}`)
  if (m.via_combusta) lines.push('  • в «выжженном пути» (15° Весов–15° Скорпиона) — неблагоприятно')
  if (m.next_aspect) lines.push(`  • следующий аспект: ${aspectPhrase(m.next_aspect)}`)
  if (m.last_aspect) lines.push(`  • последний аспект: ${aspectPhrase(m.last_aspect)}`)
  return lines.join('\n')
}

function radicalityBlock(chart: HoraryChart): string {
  const r = chart.radicality
  const flags: string[] = []
  if (r.ascendant_too_early) flags.push('Асцендент в ранних градусах (<3°) — вопрос, возможно, преждевременный')
  if (r.ascendant_too_late) flags.push('Асцендент в поздних градусах (>27°) — дело, возможно, уже решено или поздно')
  if (r.moon_void_of_course) flags.push('Луна без курса — классический признак «ничего не выйдет / без развития»')
  if (r.moon_via_combusta) flags.push('Луна в выжженном пути — суждение с осторожностью')
  if (r.saturn_in_first_or_seventh) flags.push('Сатурн в 1-м или 7-м доме — классическое предостережение против поспешного суждения')
  if (flags.length === 0) return 'РАДИКАЛЬНОСТЬ: особых предостережений нет — карта пригодна к суждению.'
  return 'РАДИКАЛЬНОСТЬ (предостережения к суждению):\n' + flags.map((f) => `  • ${f}`).join('\n')
}

function receptionBlock(chart: HoraryChart): string {
  const rec = chart.receptions
  if (rec.mutual) return `РЕЦЕПЦИЯ: взаимная рецепция между сигнификаторами (${rec.p1_receives_p2.join(', ')} ↔ ${rec.p2_receives_p1.join(', ')}) — сильное взаимное содействие.`
  if (rec.p1_receives_p2.length) return `РЕЦЕПЦИЯ: управитель спрашивающего принимает управителя предмета вопроса (${rec.p1_receives_p2.join(', ')}).`
  if (rec.p2_receives_p1.length) return `РЕЦЕПЦИЯ: управитель предмета вопроса принимает управителя спрашивающего (${rec.p2_receives_p1.join(', ')}).`
  return 'РЕЦЕПЦИЯ: между сигнификаторами нет рецепции.'
}

const SYSTEM_PROMPT = `Ты — опытный астролог-хорарист школы Уильяма Лилли. Тебе дают уже ГОТОВЫЙ разбор хорарной карты и вычисленный вердикт. Твоя задача — понятно и тепло объяснить это суждение на русском языке.

КРИТИЧЕСКИ ВАЖНО:
- Вердикт (ДА / НЕТ / ДА С УСЛОВИЯМИ) уже вычислен детерминированно по правилам традиционной астрологии. Ты НЕ имеешь права его менять, оспаривать или подменять своим. Твой ответ обязан соответствовать полю «ВЕРДИКТ».
- Опирайся ТОЛЬКО на приведённые данные (сигнификаторы, аспекты, достоинства, Луна, рецепции, радикальность, причины). Не выдумывай планеты, аспекты, градусы или дома, которых нет в данных.
- Не пересчитывай карту и не привлекай натальную астрологию — это хорар, суждение на конкретный вопрос по моменту.

Способ, которым дело «свершается» (perfection_mode), объясни простыми словами:
- direct — сигнификаторы сами сходятся в аспекте (стороны договариваются напрямую);
- translation — третья планета переносит свет между ними (помогает посредник);
- collection — более медленная планета собирает свет обоих (дело решается через третью сторону/инстанцию);
- prohibition — другая планета вмешивается раньше и перебивает (помеха, дело срывается);
- refranation — сигнификатор разворачивается/стационарит до завершения аспекта (сторона идёт на попятную, сделка срывается);
- moon — содействие через Луну;
- same-ruler — у сторон один управитель (дело тесно завязано на самого спрашивающего);
- none — перфекции нет (аспект не складывается).

Структура ответа (Markdown, подзаголовки уровня ## не глубже):
1. **Прямой ответ.** Начни с чёткого ДА / НЕТ / ДА, но с условиями — строго по вердикту.
2. **Почему так.** Объясни через сигнификаторов и способ свершения (perfection_mode), их достоинства/слабости, аспект и его применительность.
3. **Когда.** Если есть тайминг — назови ориентировочный срок, но честно оговори, что единица (дни/недели/месяцы) в хораре зависит от угловатости и знаков, поэтому это оценка, а не точная дата.
4. **Нюансы и предостережения.** Учти радикальность, состояние Луны, рецепции — что усиливает или ослабляет ответ.
5. **Короткий практичный итог** (1–2 предложения).

Тон: спокойный, поддерживающий, без фатализма и без гарантий (медицинских, юридических, финансовых). Пиши СТРОГО на русском, без слов и иероглифов на других языках. Не выводи «сырые» английские имена планет — используй русские.`

export interface HoraryPromptInput {
  chart: HoraryChart
}

export function buildHoraryPrompt(input: HoraryPromptInput): ChatMessage[] {
  const { chart } = input
  const j = chart.judgment

  const houseMeaning = HOUSE_MEANINGS_RU[chart.quesited_house] ?? ''

  const userParts = [
    `ВОПРОС: «${chart.question}»`,
    `Предмет вопроса — ${chart.quesited_house}-й дом (${houseMeaning}).`,
    `Карта на момент вопроса: ${chart.moment_local} (${chart.timezone}), ${chart.is_day_chart ? 'дневная' : 'ночная'}.`,
    '',
    `ВЕРДИКТ: ${ru(VERDICT_RU, j.verdict)}`,
    `Способ свершения (perfection_mode): ${j.perfection_mode ?? 'none'}.`,
    j.timing_days != null ? `Ориентир по таймингу: ~${j.timing_days} условных единиц (градусов до перфекции).` : 'Тайминг: не определён.',
    'Причины (уже вычислены движком):',
    ...j.reasons.map((r) => `  • ${r}`),
    '',
    'СИГНИФИКАТОРЫ:',
    significatorBlock('Спрашивающий (кверент)', chart.querent),
    significatorBlock('Предмет вопроса (квезит)', chart.quesited),
    '',
    receptionBlock(chart),
    '',
    moonBlock(chart),
    '',
    radicalityBlock(chart),
  ]

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userParts.join('\n') },
  ]
}
