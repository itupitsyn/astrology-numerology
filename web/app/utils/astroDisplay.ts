/** Shared display helpers for rendering a natal chart + numerology in the UI. */
import type { CelestialPoint, NumerologyNumber, NumerologyResult } from '~~/shared/types'

export const SIGN: Record<string, { ru: string; glyph: string }> = {
  Ari: { ru: 'Овен', glyph: '♈' }, Tau: { ru: 'Телец', glyph: '♉' },
  Gem: { ru: 'Близнецы', glyph: '♊' }, Can: { ru: 'Рак', glyph: '♋' },
  Leo: { ru: 'Лев', glyph: '♌' }, Vir: { ru: 'Дева', glyph: '♍' },
  Lib: { ru: 'Весы', glyph: '♎' }, Sco: { ru: 'Скорпион', glyph: '♏' },
  Sag: { ru: 'Стрелец', glyph: '♐' }, Cap: { ru: 'Козерог', glyph: '♑' },
  Aqu: { ru: 'Водолей', glyph: '♒' }, Pis: { ru: 'Рыбы', glyph: '♓' },
}

export const POINT: Record<string, string> = {
  Sun: 'Солнце', Moon: 'Луна', Mercury: 'Меркурий', Venus: 'Венера', Mars: 'Марс',
  Jupiter: 'Юпитер', Saturn: 'Сатурн', Uranus: 'Уран', Neptune: 'Нептун', Pluto: 'Плутон',
  Mean_Node: 'Восх. узел', True_Node: 'Восх. узел', Mean_South_Node: 'Нисх. узел',
  True_South_Node: 'Нисх. узел', Chiron: 'Хирон', Mean_Lilith: 'Лилит',
  Ascendant: 'Асцендент', Medium_Coeli: 'MC', Descendant: 'Десцендент', Imum_Coeli: 'IC',
}

const HOUSE: Record<string, number> = {
  First_House: 1, Second_House: 2, Third_House: 3, Fourth_House: 4, Fifth_House: 5,
  Sixth_House: 6, Seventh_House: 7, Eighth_House: 8, Ninth_House: 9, Tenth_House: 10,
  Eleventh_House: 11, Twelfth_House: 12,
}

export const sign = (s: string) => SIGN[s] ?? { ru: s, glyph: '' }
export const point = (n: string) => POINT[n] ?? n
export const houseNum = (h?: string | null) => (h && HOUSE[h] ? HOUSE[h] : null)
export const deg = (n: number) => `${n.toFixed(1)}°`

/** Segments describing a chart point, e.g. ["Солнце", "♍ Дева 1.9°", "8 дом", "R"]. */
export function pointLine(p: CelestialPoint): string[] {
  const h = houseNum(p.house)
  return [
    point(p.name),
    `${sign(p.sign).glyph} ${sign(p.sign).ru} ${deg(p.position)}`,
    h ? `${h} дом` : null,
    p.retrograde ? 'R' : null,
  ].filter((x): x is string => !!x)
}

/** Ordered, labelled list of the numerology numbers that are present. */
export function numList(num: NumerologyResult): Array<{ label: string; n: NumerologyNumber }> {
  return [
    { label: 'Жизненный путь', n: num.lifePath },
    { label: 'Выражение', n: num.expression },
    { label: 'Душа', n: num.soulUrge },
    { label: 'Личность', n: num.personality },
    { label: 'День рождения', n: num.birthday },
    { label: 'Зрелость', n: num.maturity },
    { label: `Личный год ${num.meta.targetYear}`, n: num.personalYear },
  ].filter((x): x is { label: string; n: NumerologyNumber } => !!x.n)
}
