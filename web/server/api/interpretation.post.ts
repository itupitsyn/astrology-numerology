import { fetchNatalChart } from '../utils/astro/client'
import type { BirthData } from '../utils/astro/types'
import { computeNumerology } from '../utils/numerology/core'
import { buildInterpretationPrompt } from '../utils/llm/prompt'
import { chatCompletion } from '../utils/llm/client'

const REQUIRED_NUMBERS = ['year', 'month', 'day', 'hour', 'minute', 'latitude', 'longitude'] as const

interface InterpretationBody extends Partial<BirthData> {
  /** Full name for name-derived numerology numbers. */
  fullName?: string
  /** Year for the Personal Year (defaults to current). */
  targetYear?: number
  /** Optional thematic focus for the interpretation. */
  focus?: string
  /** Optional LLM controls. */
  temperature?: number
  maxTokens?: number
  enableThinking?: boolean
}

/**
 * POST /api/interpretation
 *
 * One call to rule them all: computes the natal chart (via astro-service) and
 * numerology (locally), feeds both to the local Qwen, and returns the generated
 * interpretation together with the underlying data.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<InterpretationBody>(event)

  for (const key of REQUIRED_NUMBERS) {
    if (typeof body?.[key] !== 'number') {
      throw createError({ statusCode: 400, statusMessage: `${key} is required and must be a number` })
    }
  }

  const birth = body as BirthData

  // 1. Natal chart + numerology in parallel (numerology is local & instant).
  const [chart, numerology] = await Promise.all([
    fetchNatalChart(event, birth),
    Promise.resolve(
      computeNumerology({
        birth: { year: birth.year, month: birth.month, day: birth.day },
        fullName: body.fullName,
        targetYear: body.targetYear,
      }),
    ),
  ])

  // 2. Build prompt and ask the LLM.
  const messages = buildInterpretationPrompt({
    chart,
    numerology,
    subjectName: body.fullName || body.name,
    focus: body.focus,
  })

  const llm = await chatCompletion(event, messages, {
    temperature: body.temperature,
    maxTokens: body.maxTokens,
    enableThinking: body.enableThinking,
  })

  return {
    interpretation: llm.content,
    model: llm.model,
    usage: llm.usage,
    finishReason: llm.finishReason,
    chart,
    numerology,
  }
})
