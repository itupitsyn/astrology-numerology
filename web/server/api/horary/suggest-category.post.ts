import { HORARY_CATEGORIES, categoryById } from '../../../shared/horary'
import { chatCompletion } from '../../utils/llm/client'

/**
 * POST /api/horary/suggest-category — classify a free-text horary question
 * into one of our HORARY_CATEGORIES (which each map to a traditional house).
 *
 * The LLM only *suggests* a category id; the user still confirms/overrides it
 * in the form. The house-based judgment itself stays driven by the chosen
 * category, so a wrong guess never silently skews the chart — it just prefills
 * the picker. Returns { categoryId: string | null }.
 */

const KNOWN_IDS = new Set(HORARY_CATEGORIES.map((c) => c.id))

const CATEGORY_LINES = HORARY_CATEGORIES.map(
  (c) => `${c.id} — ${c.label}: ${c.hint}`,
).join('\n')

const SYSTEM_PROMPT = `Ты классифицируешь хорарный (астрологический) вопрос по теме. Тебе дают вопрос пользователя и список тем в формате "id — название: пояснение". Выбери ОДНУ наиболее подходящую тему и верни СТРОГО только её id (например: career). Без кавычек, без пояснений, без других слов. Если ни одна тема явно не подходит, верни строку none.

Список тем:
${CATEGORY_LINES}`

/** Extract a known category id from the model's raw output, or null. */
function parseCategoryId(raw: string): string | null {
  const text = raw.toLowerCase()
  const cleaned = text.replace(/[^a-z]/g, ' ').trim()
  if (KNOWN_IDS.has(cleaned)) return cleaned
  // Model added stray words — take the first known id it mentions.
  let best: { id: string; idx: number } | null = null
  for (const id of KNOWN_IDS) {
    const idx = text.indexOf(id)
    if (idx !== -1 && (!best || idx < best.idx)) best = { id, idx }
  }
  return best?.id ?? null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ question?: string }>(event)
  const question = body?.question?.trim()
  if (!question) {
    throw createError({ statusCode: 400, statusMessage: 'question is required' })
  }

  const { content } = await chatCompletion(
    event,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Вопрос: «${question}»\nid темы:` },
    ],
    { temperature: 0, maxTokens: 20, enableThinking: false, timeoutMs: 30_000 },
  )

  const id = parseCategoryId(content)
  return { categoryId: id && categoryById(id) ? id : null }
})
