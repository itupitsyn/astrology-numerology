import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyTelegramInitData } from './auth'

const BOT_TOKEN = '123456:AA-test-token-not-a-real-one'

/**
 * Build a correctly signed initData string, the way a Telegram client would.
 * `dropSignature` reproduces the SDKs that leave `signature` out of the check
 * string, which is the ambiguity the verifier has to tolerate.
 */
function signInitData(fields: Record<string, string>, dropSignature = false): string {
  const params = new URLSearchParams(fields)
  const checkString = [...params.entries()]
    .filter(([key]) => !(dropSignature && key === 'signature'))
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const hash = createHmac('sha256', secret).update(checkString).digest('hex')
  params.set('hash', hash)
  return params.toString()
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

const USER = { id: 4242, first_name: 'Тест', username: 'tester' }

describe('verifyTelegramInitData', () => {
  it('accepts data signed with the bot token', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      query_id: 'AAA',
      user: JSON.stringify(USER),
    })
    expect(verifyTelegramInitData(initData, BOT_TOKEN)?.id).toBe(4242)
  })

  it('rejects a tampered payload', () => {
    // The attack this exists to stop: claiming somebody else's Telegram id.
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: JSON.stringify(USER),
    })
    const forged = new URLSearchParams(initData)
    forged.set('user', JSON.stringify({ ...USER, id: 9999 })) // hash left untouched
    expect(verifyTelegramInitData(forged.toString(), BOT_TOKEN)).toBeNull()
  })

  it('rejects data signed with a different token', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: JSON.stringify(USER),
    })
    expect(verifyTelegramInitData(initData, '999:other-token')).toBeNull()
  })

  it('rejects data with no hash at all', () => {
    const params = new URLSearchParams({
      auth_date: String(nowSeconds()),
      user: JSON.stringify(USER),
    })
    expect(verifyTelegramInitData(params.toString(), BOT_TOKEN)).toBeNull()
  })

  it('rejects stale data', () => {
    // Replay guard: a leaked initData string must not stay valid forever.
    const initData = signInitData({
      auth_date: String(nowSeconds() - 7200),
      user: JSON.stringify(USER),
    })
    expect(verifyTelegramInitData(initData, BOT_TOKEN, 3600)).toBeNull()
    expect(verifyTelegramInitData(initData, BOT_TOKEN, 86_400)?.id).toBe(4242)
  })

  it('rejects data with no user', () => {
    const initData = signInitData({ auth_date: String(nowSeconds()), query_id: 'AAA' })
    expect(verifyTelegramInitData(initData, BOT_TOKEN)).toBeNull()
  })

  it('accepts a payload carrying the newer signature field, signed either way', () => {
    // Newer clients also send `signature` for the separate Ed25519 scheme. The
    // spec excludes only `hash` from the check string, but some SDKs strip
    // `signature` too — both readings must verify, or real users get rejected
    // over an ambiguity we cannot settle without a live client.
    const fields = {
      auth_date: String(nowSeconds()),
      signature: 'abcdef',
      user: JSON.stringify(USER),
    }
    expect(verifyTelegramInitData(signInitData(fields, false), BOT_TOKEN)?.id).toBe(4242)
    expect(verifyTelegramInitData(signInitData(fields, true), BOT_TOKEN)?.id).toBe(4242)
  })

  it('returns null instead of throwing on junk input', () => {
    expect(verifyTelegramInitData('', BOT_TOKEN)).toBeNull()
    expect(verifyTelegramInitData('not-query-string', BOT_TOKEN)).toBeNull()
    expect(verifyTelegramInitData('hash=deadbeef&user=%7Bbroken', BOT_TOKEN)).toBeNull()
  })

  it('returns null when no bot token is configured', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: JSON.stringify(USER),
    })
    expect(verifyTelegramInitData(initData, '')).toBeNull()
  })
})
