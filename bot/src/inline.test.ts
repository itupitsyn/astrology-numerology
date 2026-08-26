import { afterEach, describe, expect, it, vi } from 'vitest'
import { NeedsProfileError } from './api'
import type { DailyResponse } from './types'

// Mocked so the handler can be driven through every failure path without a
// network. `vi.mock` is hoisted, hence the factory rather than a closure.
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, fetchDaily: vi.fn() }
})

const { fetchDaily } = await import('./api')
const { forgetInlineCache, handleInlineQuery } = await import('./inline')

const TELEGRAM_ID = 4242

/** Records what the handler answered Telegram with. */
function fakeContext() {
  const answers: Array<{ results: unknown[]; other?: Record<string, unknown> }> = []
  return {
    answers,
    ctx: {
      from: { id: TELEGRAM_ID },
      answerInlineQuery: vi.fn(async (results: unknown[], other?: Record<string, unknown>) => {
        answers.push({ results, other })
        return true as const
      }),
    },
  }
}

function reading(): DailyResponse {
  return {
    id: null,
    status: 'pending',
    date: '2026-08-27',
    timezone: 'Europe/Moscow',
    text: null,
    model: null,
    promptVersion: null,
    error: null,
    numerology: { personalDay: { value: 9, isMaster: false }, personalYear: { value: 3, isMaster: false } },
    forecast: {
      date: '2026-08-27',
      timezone: 'Europe/Moscow',
      houses_known: true,
      moon: {
        sign_ru: 'Водолей',
        phase_name: 'Полнолуние',
        illumination: 0.97,
        waxing: false,
        natal_house: 5,
        void_of_course: [],
      },
      retrogrades: [],
      events: [],
      highlights: [
        {
          kind: 'natal_aspect',
          layer: 'today',
          score: 2,
          title: 'Луна в тригоне к натальному Солнцу',
          detail: '',
          time_local: '2026-08-27T09:00',
        },
      ],
    },
  }
}

afterEach(() => {
  forgetInlineCache(TELEGRAM_ID)
  vi.mocked(fetchDaily).mockReset()
})

describe('handleInlineQuery', () => {
  it('offers the brief and the longer variant', async () => {
    vi.mocked(fetchDaily).mockResolvedValue(reading())
    const { ctx, answers } = fakeContext()

    await handleInlineQuery(ctx as never)

    expect(answers).toHaveLength(1)
    expect(answers[0]!.results).toHaveLength(2)
    expect(answers[0]!.other).toMatchObject({ is_personal: true })
  })

  it('marks results personal so Telegram cannot share them between users', async () => {
    // Without is_personal, one person's natal forecast can be cached and served
    // to somebody else typing the same query.
    vi.mocked(fetchDaily).mockResolvedValue(reading())
    const { ctx, answers } = fakeContext()

    await handleInlineQuery(ctx as never)

    expect(answers[0]!.other!.is_personal).toBe(true)
  })

  it('never generates — a keystroke must not start a GPU job', async () => {
    vi.mocked(fetchDaily).mockResolvedValue(reading())
    const { ctx } = fakeContext()

    await handleInlineQuery(ctx as never)

    expect(vi.mocked(fetchDaily).mock.calls[0]![1]).toMatchObject({ generate: false })
  })

  it('uses a short timeout, because Telegram closes the window in seconds', async () => {
    vi.mocked(fetchDaily).mockResolvedValue(reading())
    const { ctx } = fakeContext()

    await handleInlineQuery(ctx as never)

    const timeout = (vi.mocked(fetchDaily).mock.calls[0]![1] as { timeoutMs: number }).timeoutMs
    expect(timeout).toBeLessThanOrEqual(6000)
  })

  it('serves repeat keystrokes from the memo instead of re-asking', async () => {
    vi.mocked(fetchDaily).mockResolvedValue(reading())
    const { ctx } = fakeContext()

    await handleInlineQuery(ctx as never)
    await handleInlineQuery(ctx as never)
    await handleInlineQuery(ctx as never)

    expect(vi.mocked(fetchDaily)).toHaveBeenCalledTimes(1)
  })

  it('shows a button, not an empty list, when there is no profile', async () => {
    vi.mocked(fetchDaily).mockRejectedValue(new NeedsProfileError('https://x.example.com/setup'))
    const { ctx, answers } = fakeContext()

    await handleInlineQuery(ctx as never)

    expect(answers[0]!.results).toHaveLength(0)
    expect(answers[0]!.other!.button).toMatchObject({ text: 'Заполнить данные' })
  })

  it('shows a button when the API fails, rather than a silent empty result', async () => {
    // An empty list on its own is indistinguishable from "still loading" — the
    // picker just sits there, which is exactly what a bare 500 looked like.
    vi.mocked(fetchDaily).mockRejectedValue(new Error('HTTP 500'))
    const { ctx, answers } = fakeContext()

    await handleInlineQuery(ctx as never)

    expect(answers).toHaveLength(1)
    expect(answers[0]!.other!.button).toBeDefined()
  })

  it('answers even when the request times out', async () => {
    vi.mocked(fetchDaily).mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    const { ctx, answers } = fakeContext()

    await handleInlineQuery(ctx as never)

    expect(answers).toHaveLength(1)
  })

  it('answers even when rendering blows up', async () => {
    // The one failure a user cannot see: an unanswered inline query leaves the
    // picker spinning forever, with no error anywhere near them.
    vi.mocked(fetchDaily).mockResolvedValue({ ...reading(), forecast: { bad: true } } as never)
    const { ctx, answers } = fakeContext()

    await expect(handleInlineQuery(ctx as never)).resolves.toBeUndefined()
    expect(answers).toHaveLength(1)
  })

  it('does nothing when there is no user to answer for', async () => {
    const { ctx, answers } = fakeContext()
    await handleInlineQuery({ ...ctx, from: undefined } as never)
    expect(answers).toHaveLength(0)
  })
})
