import { fetchHoraryChart } from '../utils/astro/client'
import { buildHoraryPrompt, HORARY_PROMPT_VERSION } from '../utils/llm/horaryPrompt'
import { chatCompletion, resolveModelId } from '../utils/llm/client'
import { parseHoraryBody, type HoraryInterpretationBody } from '../utils/horaryInput'
import { newHoraryId, saveHoraryReading } from '../utils/readings'

/**
 * POST /api/horary-interpretation (non-streaming).
 *
 * Casts the horary chart (astro-service /horary — verdict computed there,
 * deterministically), asks the local Qwen to narrate that verdict without
 * changing it, persists the reading, and returns everything at once.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<HoraryInterpretationBody>(event)
  const { question, category } = parseHoraryBody(body)
  const cfg = useRuntimeConfig(event)

  const chart = await fetchHoraryChart(event, question)
  const messages = buildHoraryPrompt({ chart })

  const llm = await chatCompletion(event, messages, {
    temperature: body.temperature,
    maxTokens: body.maxTokens,
    enableThinking: body.enableThinking,
  })

  let horaryId: string | null = newHoraryId()
  try {
    await saveHoraryReading({
      id: horaryId,
      question: chart.question,
      category,
      quesitedHouse: chart.quesited_house,
      querentHouse: chart.querent_house,
      city: body.city ?? null,
      momentUtc: chart.moment_utc,
      momentLocal: chart.moment_local,
      timezone: chart.timezone,
      latitude: chart.latitude,
      longitude: chart.longitude,
      verdict: chart.judgment.verdict,
      perfectionMode: chart.judgment.perfection_mode ?? null,
      horary: chart,
      interpretation: llm.content,
      model: llm.model ?? (await resolveModelId(cfg.llm)),
      promptVersion: HORARY_PROMPT_VERSION,
      usage: llm.usage,
    })
  } catch (dbErr) {
    console.error('Failed to persist horary reading:', dbErr)
    horaryId = null // still return the result; just not shareable
  }

  return {
    horaryId,
    interpretation: llm.content,
    model: llm.model,
    usage: llm.usage,
    finishReason: llm.finishReason,
    horary: chart,
  }
})
