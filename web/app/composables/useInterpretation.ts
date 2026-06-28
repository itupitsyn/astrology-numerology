import type { InterpretationMeta, InterpretationRequest } from '~~/shared/types'

type Status = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

/**
 * Drives POST /api/interpretation/stream and consumes its SSE events
 * (meta → delta* → done | error) via the fetch ReadableStream.
 */
export function useInterpretation() {
  const status = ref<Status>('idle')
  const meta = ref<InterpretationMeta | null>(null)
  const text = ref('')
  const error = ref<string | null>(null)
  const readingId = ref<string | null>(null)
  const feedback = ref<1 | -1 | null>(null)

  function reset() {
    status.value = 'idle'
    meta.value = null
    text.value = ''
    error.value = null
    readingId.value = null
    feedback.value = null
  }

  async function sendFeedback(rating: 1 | -1) {
    if (!readingId.value) return
    feedback.value = rating // optimistic
    try {
      await $fetch(`/api/readings/${readingId.value}/feedback`, {
        method: 'POST',
        body: { rating },
      })
    } catch {
      feedback.value = null // roll back on failure
    }
  }

  async function generate(payload: InterpretationRequest) {
    reset()
    status.value = 'loading'

    let res: Response
    try {
      res = await fetch('/api/interpretation/stream', {
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
          const data = line.slice(5).trim()
          handleEvent(event, data)
        }
      }
    }

    if (status.value === 'streaming') status.value = 'done'
  }

  function handleEvent(event: string, data: string) {
    switch (event) {
      case 'meta':
        try {
          meta.value = JSON.parse(data) as InterpretationMeta
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
          readingId.value = (JSON.parse(data) as { readingId: string | null }).readingId
        } catch { /* ignore */ }
        status.value = 'done'
        break
    }
  }

  return { status, meta, text, error, readingId, feedback, generate, reset, sendFeedback }
}
