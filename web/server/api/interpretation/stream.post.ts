import { fetchNatalChart } from '../../utils/astro/client'
import type { BirthData } from '../../utils/astro/types'
import { computeNumerology } from '../../utils/numerology/core'
import { buildInterpretationPrompt, PROMPT_VERSION } from '../../utils/llm/prompt'
import { resolveModelId, streamChatCompletion } from '../../utils/llm/client'
import { newReadingId, saveReading } from '../../utils/readings'

const REQUIRED_NUMBERS = ['year', 'month', 'day', 'hour', 'minute', 'latitude', 'longitude'] as const

interface InterpretationBody extends Partial<BirthData> {
  fullName?: string
  targetYear?: number
  focus?: string
  temperature?: number
  enableThinking?: boolean
}

/**
 * POST /api/interpretation/stream — Server-Sent Events.
 *
 * Emits:
 *   event: meta   data: { chart, numerology }          (once, first)
 *   event: delta  data: "<text chunk>"                  (many, JSON-encoded)
 *   event: error  data: "<message>"                     (on LLM failure)
 *   event: done   data: { readingId: string | null }    (once, last)
 *
 * On completion the full reading is persisted; its id (for the share link) is
 * returned in the `done` event. A persistence failure does not break the stream.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<InterpretationBody>(event)

  for (const key of REQUIRED_NUMBERS) {
    if (typeof body?.[key] !== 'number') {
      throw createError({ statusCode: 400, statusMessage: `${key} is required and must be a number` })
    }
  }

  const birth = body as BirthData
  const cfg = useRuntimeConfig(event)

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

  const messages = buildInterpretationPrompt({
    chart,
    numerology,
    subjectName: body.fullName || body.name,
    focus: body.focus,
  })

  const eventStream = createEventStream(event)

  ;(async () => {
    let fullText = ''
    try {
      await eventStream.push({ event: 'meta', data: JSON.stringify({ chart, numerology }) })
      for await (const delta of streamChatCompletion(event, messages, {
        temperature: body.temperature,
        enableThinking: body.enableThinking,
      })) {
        fullText += delta
        await eventStream.push({ event: 'delta', data: JSON.stringify(delta) })
      }

      // Persist the finished reading; the share id rides in the `done` event.
      let readingId: string | null = newReadingId()
      try {
        await saveReading({
          id: readingId,
          name: body.name ?? null,
          fullName: body.fullName ?? null,
          city: body.city ?? null,
          birthYear: birth.year,
          birthMonth: birth.month,
          birthDay: birth.day,
          birthHour: birth.hour,
          birthMinute: birth.minute,
          latitude: birth.latitude,
          longitude: birth.longitude,
          timezone: birth.timezone ?? null,
          targetYear: body.targetYear ?? null,
          focus: body.focus ?? null,
          chart,
          numerology,
          interpretation: fullText,
          model: await resolveModelId(cfg.llm),
          promptVersion: PROMPT_VERSION,
        })
      } catch (dbErr) {
        console.error('Failed to persist reading:', dbErr)
        readingId = null // text still delivered; just not shareable
      }

      await eventStream.push({ event: 'done', data: JSON.stringify({ readingId }) })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'LLM stream failed'
      await eventStream.push({ event: 'error', data: JSON.stringify(message) })
    } finally {
      await eventStream.close()
    }
  })()

  return eventStream.send()
})
