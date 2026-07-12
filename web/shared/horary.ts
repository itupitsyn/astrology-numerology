/**
 * Horary question categories mapped to traditional (Lilly) houses.
 *
 * The "quesited" house is what the question is *about*. Rather than make the
 * user pick a house number, the UI offers these friendly categories and this
 * table maps the chosen category to its house. Shared between the app (the
 * picker) and the server (validating / resolving the house).
 */

export interface HoraryCategory {
  /** Stable id sent from the client. */
  id: string
  /** User-facing Russian label. */
  label: string
  /** Traditional horary house the question is about. */
  house: number
  /** Short hint shown under the label. */
  hint: string
}

export const HORARY_CATEGORIES: HoraryCategory[] = [
  // 2 — money & possessions
  { id: 'money', label: 'Деньги и доходы', house: 2, hint: 'Получу ли деньги, вернут ли долг, будет ли прибыль' },
  { id: 'possession', label: 'Вещь / имущество', house: 2, hint: 'Куплю ли, продам ли, сохраню ли имущество' },
  // 3 — siblings, neighbours, short trips, learning, news
  { id: 'news', label: 'Новости и вести', house: 3, hint: 'Придут ли новости, правдив ли слух' },
  { id: 'siblings', label: 'Братья, сёстры, соседи', house: 3, hint: 'Вопросы о родне и ближнем окружении' },
  { id: 'study', label: 'Учёба и короткие поездки', house: 3, hint: 'Сдам ли, стоит ли ехать недалеко' },
  // 4 — home, property, parents/land, end of matter
  { id: 'home', label: 'Дом и недвижимость', house: 4, hint: 'Купить/снять жильё, переезд, земля' },
  { id: 'father', label: 'Родители / отец', house: 4, hint: 'Вопросы об отце, семье, корнях' },
  // 5 — children, pregnancy, romance, pleasure, speculation
  { id: 'pregnancy', label: 'Дети и беременность', house: 5, hint: 'Будет ли ребёнок, вопросы о детях' },
  { id: 'romance', label: 'Роман / свидания', house: 5, hint: 'Начнётся ли роман, нравлюсь ли (без обязательств)' },
  { id: 'speculation', label: 'Ставки и удача', house: 5, hint: 'Повезёт ли, выиграю ли' },
  // 6 — health, illness, work (as labour), servants, small animals
  { id: 'health', label: 'Здоровье и болезнь', house: 6, hint: 'Выздоровею ли, в чём причина недомогания' },
  { id: 'work', label: 'Текущая работа / служба', house: 6, hint: 'Отношения с работой, подчинёнными, коллегами' },
  { id: 'pets', label: 'Домашние животные', house: 6, hint: 'Мелкие питомцы (крупные — 12-й дом)' },
  // 7 — partner, marriage, relationships, opponents, thieves, the "other"
  { id: 'marriage', label: 'Брак и партнёр', house: 7, hint: 'Поженимся ли, вернётся ли, серьёзные отношения' },
  { id: 'relationship', label: 'Отношения (пара)', house: 7, hint: 'Будущее конкретных отношений' },
  { id: 'opponent', label: 'Соперник / спор', house: 7, hint: 'Оппонент, конкурент, судебный противник' },
  { id: 'lost', label: 'Пропажа / кража', house: 7, hint: 'Найдётся ли вещь, кто вор' },
  // 8 — death, inheritance, partner's money, crises, debts
  { id: 'inheritance', label: 'Наследство и чужие деньги', house: 8, hint: 'Наследство, деньги партнёра, долги' },
  // 9 — long journeys, abroad, higher study, religion, law, dreams
  { id: 'travel', label: 'Дальняя поездка / заграница', house: 9, hint: 'Уеду ли, получу ли визу, эмиграция' },
  { id: 'law', label: 'Суд и закон', house: 9, hint: 'Исход судебного дела, юридический вопрос' },
  // 10 — career, status, boss, reputation, mother
  { id: 'career', label: 'Карьера и статус', house: 10, hint: 'Получу ли работу/должность, повышение, репутация' },
  { id: 'boss', label: 'Начальство', house: 10, hint: 'Отношения с руководством, властью' },
  // 11 — hopes & wishes, friends, benefactors
  { id: 'hopes', label: 'Надежды и желания', house: 11, hint: 'Сбудется ли то, на что надеюсь' },
  { id: 'friends', label: 'Друзья и покровители', house: 11, hint: 'Помогут ли, вопросы о друзьях' },
  // 12 — secret enemies, confinement, loss, large animals, the hidden
  { id: 'enemies', label: 'Тайные враги / скрытое', house: 12, hint: 'Кто вредит втайне, скрытые обстоятельства' },
]

const _BY_ID = new Map(HORARY_CATEGORIES.map((c) => [c.id, c]))

/** Resolve a category id to its horary house, or null if unknown. */
export function houseForCategory(id: string): number | null {
  return _BY_ID.get(id)?.house ?? null
}

export function categoryById(id: string): HoraryCategory | undefined {
  return _BY_ID.get(id)
}

/** Human-readable meaning of each house, for prompt context and UI. */
export const HOUSE_MEANINGS_RU: Record<number, string> = {
  1: 'спрашивающий, его состояние и сама ситуация',
  2: 'деньги, имущество, доходы спрашивающего',
  3: 'братья/сёстры, соседи, короткие поездки, обучение, новости',
  4: 'дом, недвижимость, родители/отец, корни, исход дела',
  5: 'дети, беременность, романы, творчество, удовольствия, ставки',
  6: 'здоровье и болезни, работа-служба, подчинённые, мелкие животные',
  7: 'партнёр, брак, отношения, любой «другой», оппоненты, воры',
  8: 'смерть, наследство, деньги партнёра, долги, кризисы',
  9: 'дальние поездки, заграница, высшее образование, религия, суд',
  10: 'карьера, статус, начальство, репутация, мать',
  11: 'надежды и желания, друзья, покровители',
  12: 'тайные враги, изоляция, потери, скрытые обстоятельства',
}
