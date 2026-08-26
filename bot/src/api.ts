/**
 * Client for the Nuxt layer's `/api/bot/*` routes.
 *
 * The bot holds no astrology, no database and no user data — it knows a
 * Telegram id and nothing else. Everything it shows comes from here.
 */

import { config } from './config'
import type { DailyResponse } from './types'

/**
 * The user has not filled in their birth data yet. Carries the link the bot
 * should send them to — built server-side so the bot never has to know where
 * the web app lives.
 */
export class NeedsProfileError extends Error {
  constructor(readonly setupUrl: string) {
    super('profile required')
    this.name = 'NeedsProfileError'
  }
}

/** The API answered, but not with something we can use. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
      ...init.headers,
    },
    signal: AbortSignal.timeout(config.apiTimeoutMs),
  })

  if (response.status === 204) return null as T

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error page; the status alone has to do.
  }

  if (!response.ok) {
    const data = body as
      | { statusMessage?: string; message?: string; data?: { needsProfile?: boolean; setupUrl?: string } }
      | null

    if (response.status === 409 && data?.data?.needsProfile && data.data.setupUrl) {
      throw new NeedsProfileError(data.data.setupUrl)
    }
    throw new ApiError(response.status, data?.statusMessage || data?.message || `HTTP ${response.status}`)
  }

  return body as T
}

export interface ProfileStatus {
  exists: boolean
  /** Where to send a user who has not filled in their data. */
  setupUrl: string
  name: string | null
  birthTimeUnknown: boolean | null
}

/**
 * Whether this user has usable data, and the link to the form.
 *
 * Free of side effects, unlike `fetchDaily` — which is why /start and /settings
 * ask this instead: probing with a forecast request would claim a generation
 * slot and start a GPU job for someone who only said hello.
 */
export function fetchProfileStatus(telegramId: number): Promise<ProfileStatus> {
  return request<ProfileStatus>('/api/bot/profile-status', {
    method: 'POST',
    body: JSON.stringify({ telegramId }),
  })
}

/**
 * Today's forecast for a Telegram user.
 *
 * Returns as soon as the facts exist. A `pending` status means the prose is
 * still generating — poll `pollDaily` for it.
 *
 * Pass `generate: false` to get the facts without causing any work: no slot is
 * claimed and no model run starts. The response then carries `id: null`, since
 * nothing was persisted and there is nothing to rate.
 */
export function fetchDaily(
  telegramId: number,
  options: { generate?: boolean } = {},
): Promise<DailyResponse> {
  return request<DailyResponse>('/api/bot/daily', {
    method: 'POST',
    body: JSON.stringify({ telegramId, ...options }),
  })
}

/** Cheap indexed read — safe to call every couple of seconds. */
export function pollDaily(readingId: string): Promise<DailyResponse> {
  return request<DailyResponse>(`/api/bot/daily/${encodeURIComponent(readingId)}`)
}

export function sendFeedback(readingId: string, rating: 1 | -1): Promise<{ ok: boolean }> {
  return request(`/api/bot/daily/${encodeURIComponent(readingId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating }),
  })
}
