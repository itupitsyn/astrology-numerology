/**
 * The plain-message fallback.
 *
 * Silence is the failure mode this guards: before it existed, anyone who typed
 * "привет" instead of a command got nothing back, which reads as a broken bot —
 * and that is the first thing many people try.
 */

import { describe, expect, it, vi } from 'vitest'
import { NeedsProfileError } from './api'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, fetchProfileStatus: vi.fn(), fetchDaily: vi.fn() }
})

const { fetchProfileStatus } = await import('./api')
const { promptForProfile } = await import('./daily')

function fakeContext(chatType = 'private') {
  const replies: Array<{ text: string; other?: Record<string, unknown> }> = []
  return {
    replies,
    ctx: {
      chat: { type: chatType },
      from: { id: 4242 },
      reply: vi.fn(async (text: string, other?: Record<string, unknown>) => {
        replies.push({ text, other })
        return {} as never
      }),
    },
  }
}

describe('promptForProfile', () => {
  it('tells a new user what is needed and offers the form', async () => {
    const { ctx, replies } = fakeContext()
    await promptForProfile(ctx as never, 'https://astro.example.com/setup')

    expect(replies).toHaveLength(1)
    expect(replies[0]!.text).toContain('дата, время и место рождения')
    expect(replies[0]!.other?.reply_markup).toBeDefined()
  })

  it('falls back to a plain link when the app is not on https', async () => {
    // Telegram refuses Mini App buttons for anything but https, and rejects
    // localhost outright — so in dev the address goes out as text instead.
    const { ctx, replies } = fakeContext()
    await promptForProfile(ctx as never, 'http://localhost:3000/setup')

    expect(replies[0]!.text).toContain('http://localhost:3000/setup')
    expect(replies[0]!.other?.reply_markup).toBeUndefined()
  })
})

describe('NeedsProfileError', () => {
  it('carries the setup link, so the bot never has to know where the app lives', () => {
    const err = new NeedsProfileError('https://astro.example.com/setup')
    expect(err.setupUrl).toBe('https://astro.example.com/setup')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('profile status', () => {
  it('is what /start and the fallback ask, since it starts no GPU job', async () => {
    vi.mocked(fetchProfileStatus).mockResolvedValue({
      exists: false,
      setupUrl: 'https://astro.example.com/setup',
      name: null,
      birthTimeUnknown: null,
    })
    const status = await fetchProfileStatus(4242)
    expect(status.exists).toBe(false)
    expect(status.setupUrl).toContain('/setup')
  })
})
