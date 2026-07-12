import type { HoraryMeta, HoraryRequest } from '~~/shared/types'

type Status = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

/**
 * Drives POST /api/horary-interpretation/stream and consumes its SSE events
 * (meta → delta* → done | error). Mirrors useInterpretation but for horary:
 * `meta` carries the full chart + the already-decided verdict, so the answer
 * is visible before the narration finishes streaming.
 */
export function useHorary() {
  const status = ref<Status>('idle')
  const meta = ref<HoraryMeta | null>(null)
  const text = ref('')
  const error = ref<string | null>(null)
  const horaryId = ref<string | null>(null)
  const feedback = ref<1 | -1 | null>(null)

  function reset() {
    status.value = 'idle'
    meta.value = null
    text.value = ''
    error.value = null
    horaryId.value = null
    feedback.value = null
  }

  async function sendFeedback(rating: 1 | -1) {
    if (!horaryId.value) return
    feedback.value = rating // optimistic
    try {
      await $fetch(`/api/horary/${horaryId.value}/feedback`, { method: 'POST', body: { rating } })
    } catch {
      feedback.value = null // roll back on failure
    }
  }

  async function ask(payload: HoraryRequest) {
    reset()
    status.value = 'loading'

    let res: Response
    try {
      res = await fetch('/api/horary-interpretation/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      status.value = 'error'
      error.value = 'Сервер недоступен'
      return
    }

    if (!res.ok || !res.body) {
      status.value = 'error'
      error.value = `Ошибка ${res.status}: ${res.statusText}`
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let event = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          handleEvent(event, line.slice(5).trim())
        }
      }
    }

    if (status.value === 'streaming') status.value = 'done'
  }

  function handleEvent(event: string, data: string) {
    switch (event) {
      case 'meta':
        try {
          meta.value = JSON.parse(data) as HoraryMeta
          status.value = 'streaming'
        } catch { /* ignore */ }
        break
      case 'delta':
        try {
          text.value += JSON.parse(data) as string
        } catch { /* ignore */ }
        break
      case 'error':
        status.value = 'error'
        try {
          error.value = JSON.parse(data) as string
        } catch {
          error.value = 'Ошибка генерации'
        }
        break
      case 'done':
        try {
          horaryId.value = (JSON.parse(data) as { horaryId: string | null }).horaryId
        } catch { /* ignore */ }
        status.value = 'done'
        break
    }
  }

  return { status, meta, text, error, horaryId, feedback, ask, reset, sendFeedback }
}
