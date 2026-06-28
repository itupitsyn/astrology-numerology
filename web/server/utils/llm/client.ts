/**
 * Server-side client for the local Qwen (llama.cpp, OpenAI-compatible API).
 *
 * Only Nitro talks to the LLM. Qwen3 emits chain-of-thought into a separate
 * `reasoning_content` field; we disable it by default for clean, fast output.
 */

import type { H3Event } from 'h3'
import { FetchError } from 'ofetch'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  /** Optional safety cap. Omit to let the model finish naturally (full answer). */
  maxTokens?: number
  /** Qwen3 reasoning toggle. Off by default. */
  enableThinking?: boolean
  stop?: string[]
  /** Request timeout in ms (the 35B model can be slow). */
  timeoutMs?: number
}

export interface ChatResult {
  content: string
  reasoning?: string
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finishReason?: string
}

interface OpenAIChatResponse {
  model: string
  choices: Array<{
    message: { content: string; reasoning_content?: string }
    finish_reason: string
  }>
  usage?: ChatResult['usage']
}

type LlmConfig = { baseUrl: string; apiKey?: string }

function authHeaders(llm: LlmConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`
  return headers
}

// Cached model id (per process) — auto-detected from /v1/models so we don't
// hardcode a vendor string and A/B labels stay accurate after a model swap.
let _modelId: string | null = null

/**
 * The model id served by the LLM. Detected once from /v1/models; llama.cpp
 * serves a single model, so this is the source of truth for the A/B label.
 */
export async function resolveModelId(llm: LlmConfig): Promise<string | null> {
  if (_modelId) return _modelId
  try {
    const res = await $fetch<{ data?: Array<{ id: string }> }>('/v1/models', {
      baseURL: llm.baseUrl,
      headers: authHeaders(llm),
      timeout: 10_000,
    })
    _modelId = res.data?.[0]?.id ?? null
  } catch {
    _modelId = null
  }
  return _modelId
}

export async function chatCompletion(
  event: H3Event,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const { llm } = useRuntimeConfig(event)

  const headers = authHeaders(llm)

  // Only cap output when a limit is explicitly requested; otherwise let the
  // model finish naturally (full-length answer). `model` is omitted: llama.cpp
  // serves a single model and ignores the field.
  const body: Record<string, unknown> = {
    messages,
    temperature: options.temperature ?? 0.7,
    stream: false,
    chat_template_kwargs: { enable_thinking: options.enableThinking ?? false },
  }
  if (options.maxTokens != null) body.max_tokens = options.maxTokens
  if (options.stop) body.stop = options.stop

  try {
    const res = await $fetch<OpenAIChatResponse>('/v1/chat/completions', {
      baseURL: llm.baseUrl,
      method: 'POST',
      headers,
      timeout: options.timeoutMs ?? 180_000,
      body,
    })

    const choice = res.choices?.[0]
    return {
      content: choice?.message?.content?.trim() ?? '',
      reasoning: choice?.message?.reasoning_content,
      model: res.model,
      usage: res.usage,
      finishReason: choice?.finish_reason,
    }
  } catch (err) {
    if (err instanceof FetchError && err.response) {
      const detail = (err.data as { error?: { message?: string } } | undefined)?.error?.message
      throw createError({
        statusCode: err.response.status,
        statusMessage: detail || err.response.statusText || 'LLM error',
      })
    }
    throw createError({ statusCode: 502, statusMessage: 'LLM service is unreachable' })
  }
}

/**
 * Streaming variant: yields content deltas as they arrive (SSE from llama.cpp).
 * Reasoning deltas (`reasoning_content`) are ignored — only final answer text
 * is yielded.
 */
export async function* streamChatCompletion(
  event: H3Event,
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<string> {
  const { llm } = useRuntimeConfig(event)

  const headers = authHeaders(llm)

  const body: Record<string, unknown> = {
    messages,
    temperature: options.temperature ?? 0.7,
    stream: true,
    chat_template_kwargs: { enable_thinking: options.enableThinking ?? false },
  }
  if (options.maxTokens != null) body.max_tokens = options.maxTokens
  if (options.stop) body.stop = options.stop

  let res: Response
  try {
    res = await fetch(`${llm.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'LLM service is unreachable' })
  }

  if (!res.ok || !res.body) {
    throw createError({ statusCode: res.status || 502, statusMessage: 'LLM stream error' })
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by newlines; keep the last partial line buffered.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data) as OpenAIChatResponse & {
          choices: Array<{ delta?: { content?: string } }>
        }
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        // Ignore keep-alive / non-JSON lines.
      }
    }
  }
}
