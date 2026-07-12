/** Display helpers for horary charts (verdict, dignities, judgment wording). */
import type { DignityInfo, HoraryAspectHit, HoraryVerdict } from '~~/shared/types'
// point() / sign() / deg() come from astroDisplay.ts (auto-imported).

export const VERDICT: Record<HoraryVerdict, { ru: string; cls: string; icon: string }> = {
  yes: { ru: 'Да', cls: 'v-yes', icon: '✓' },
  no: { ru: 'Нет', cls: 'v-no', icon: '✕' },
  qualified: { ru: 'Да, но с условиями', cls: 'v-maybe', icon: '≈' },
}

export const PERFECTION_MODE_RU: Record<string, string> = {
  direct: 'прямая перфекция — стороны сходятся сами',
  translation: 'перенос света — помогает посредник',
  collection: 'собирание света — решается через третью сторону',
  prohibition: 'прохибиция — вмешательство перебивает дело',
  refranation: 'рефранация — сигнификатор разворачивается, дело срывается',
  moon: 'содействие через Луну',
  'same-ruler': 'общий управитель — дело завязано на самого спрашивающего',
  none: 'перфекции нет — аспект не складывается',
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

/** Short human summary of a significator's essential dignities. */
export function dignitySummary(d: DignityInfo): string {
  const strengths = DIGNITY_LABELS.filter(([k]) => d[k]).map(([, l]) => l)
  const weaknesses = DEBILITY_LABELS.filter(([k]) => d[k]).map(([, l]) => l)
  if (d.peregrine && weaknesses.length === 0) weaknesses.push('перегрин')
  const parts: string[] = []
  if (strengths.length) parts.push(strengths.join(', '))
  if (weaknesses.length) parts.push(weaknesses.join(', '))
  return parts.length ? parts.join('; ') : 'без достоинств'
}

const ASPECT_RU: Record<string, string> = {
  conjunction: 'соединение', sextile: 'секстиль', square: 'квадрат',
  trine: 'тригон', opposition: 'оппозиция',
}

/** One-line phrasing of a Moon aspect, e.g. "Луна тригон Солнце — сходится, 3.2°". */
export function aspectPhrase(a: HoraryAspectHit): string {
  const kind = a.applying ? 'сходится' : 'расходится'
  const to = a.degrees_to_perfect != null ? `, ${a.degrees_to_perfect.toFixed(1)}°` : ''
  return `${point(a.p1)} ${ASPECT_RU[a.aspect] ?? a.aspect} ${point(a.p2)} — ${kind}${to}`
}
