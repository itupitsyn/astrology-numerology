/**
 * Who is calling.
 *
 * Two callers, two mechanisms:
 *
 *  - **The bot** talks server-to-server and presents a shared secret. The daily
 *    endpoint is the most expensive one in the app (it can start a GPU job), so
 *    unlike the existing public endpoints it must not be left open.
 *  - **The web app** runs inside Telegram and presents `initData`, which the
 *    Telegram client signs with the bot token. Verifying that signature yields
 *    a trustworthy user id for free — no bespoke token table, and no way for a
 *    caller to claim someone else's id.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** Reject the request unless it carries the bot's shared secret. */
export function requireBotAuth(event: H3Event): void {
  const { botApiKey } = useRuntimeConfig(event)
  if (!botApiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'bot API is not configured (set NUXT_BOT_API_KEY)',
    })
  }
  const provided = getHeader(event, 'x-api-key') ?? ''
  if (!safeEqual(provided, String(botApiKey))) {
    throw createError({ statusCode: 401, statusMessage: 'invalid or missing X-API-Key' })
  }
}

function hmacHex(key: string | Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex')
}

function checkString(params: URLSearchParams, dropSignature: boolean): string {
  const entries: string[] = []
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue
    if (dropSignature && key === 'signature') continue
    entries.push(`${key}=${value}`)
  }
  return entries.sort().join('\n')
}

/**
 * Verify Telegram Mini App `initData` and return the user it identifies.
 *
 * Returns null for anything that does not check out — bad signature, missing
 * user, or data older than `maxAgeSeconds` (a replay guard: a leaked initData
 * string should not stay valid forever).
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): TelegramUser | null {
  if (!initData || !botToken) return null

  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return null
  }

  const hash = params.get('hash')
  if (!hash) return null

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()

  // The spec says to exclude only `hash` from the check string. Newer clients
  // also send `signature` (for the separate Ed25519 scheme), and some Telegram
  // SDKs strip it as well — so accept either reading rather than rejecting real
  // users over an ambiguity we cannot resolve without a live client.
  const matches = [false, true].some((dropSignature) =>
    safeEqual(hmacHex(secret, checkString(params, dropSignature)), hash),
  )
  if (!matches) return null

  const authDate = Number(params.get('auth_date'))
  if (!Number.isFinite(authDate)) return null
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return null

  const rawUser = params.get('user')
  if (!rawUser) return null
  try {
    const user = JSON.parse(rawUser) as TelegramUser
    return Number.isFinite(user?.id) ? user : null
  } catch {
    return null
  }
}

/**
 * Identify the Telegram user behind a web-app request.
 *
 * `initData` is taken from the `X-Telegram-Init-Data` header, which keeps it out
 * of URLs and server logs.
 */
export function requireTelegramUser(event: H3Event): TelegramUser {
  const { telegramBotToken } = useRuntimeConfig(event)
  if (!telegramBotToken) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Telegram auth is not configured (set NUXT_TELEGRAM_BOT_TOKEN)',
    })
  }

  const initData = getHeader(event, 'x-telegram-init-data') ?? ''
  const user = verifyTelegramInitData(initData, String(telegramBotToken))
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'invalid Telegram initData' })
  }
  return user
}
