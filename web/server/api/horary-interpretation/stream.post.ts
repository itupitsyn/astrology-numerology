import { fetchHoraryChart } from '../../utils/astro/client'
import { buildHoraryPrompt, HORARY_PROMPT_VERSION } from '../../utils/llm/horaryPrompt'
import { resolveModelId, streamChatCompletion } from '../../utils/llm/client'
import { parseHoraryBody, type HoraryInterpretationBody } from '../../utils/horaryInput'
import { newHoraryId, saveHoraryReading } from '../../utils/readings'

/**
 * POST /api/horary-interpretation/stream — Server-Sent Events.
 *
 * Emits:
 *   event: meta   data: { horary }                    (once, first — chart + verdict)
 *   event: delta  data: "<text chunk>"                (many, JSON-encoded)
 *   event: error  data: "<message>"                   (on LLM failure)
 *   event: done   data: { horaryId: string | null }   (once, last)
 *
 * The verdict is already decided by astro-service; the LLM only narrates it.
 * On completion the reading is persisted; its share id rides in `done`.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<HoraryInterpretationBody>(event)
  const { question, category } = parseHoraryBody(body)
  const cfg = useRuntimeConfig(event)

  const chart = await fetchHoraryChart(event, question)
  const messages = buildHoraryPrompt({ chart })

  const eventStream = createEventStream(event)

  ;(async () => {
    let fullText = ''
    try {
      await eventStream.push({ event: 'meta', data: JSON.stringify({ horary: chart }) })

      for await (const delta of streamChatCompletion(event, messages, {
        temperature: body.temperature,
        enableThinking: body.enableThinking,
      })) {
        fullText += delta
        await eventStream.push({ event: 'delta', data: JSON.stringify(delta) })
      }

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
          interpretation: fullText,
          model: await resolveModelId(cfg.llm),
          promptVersion: HORARY_PROMPT_VERSION,
        })
      } catch (dbErr) {
        console.error('Failed to persist horary reading:', dbErr)
        horaryId = null // text still delivered; just not shareable
      }

      await eventStream.push({ event: 'done', data: JSON.stringify({ horaryId }) })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'LLM stream failed'
      await eventStream.push({ event: 'error', data: JSON.stringify(message) })
    } finally {
      await eventStream.close()
    }
  })()

  return eventStream.send()
})
