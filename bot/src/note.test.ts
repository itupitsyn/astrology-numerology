import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, fetchDaily: vi.fn() }
})

const { fetchDaily } = await import('./api')
const { sendInlineNote } = await import('./note')

const OWNER = 4242

function fakeContext(fromId: number) {
  return {
    from: { id: fromId },
    callbackQuery: { inline_message_id: 'inline-1' },
    answerCallbackQuery: vi.fn(async () => true),
    api: { editMessageTextInline: vi.fn(async () => true) },
  }
}

describe('sendInlineNote', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('does not let someone else in the chat start the recording', async () => {
    vi.stubEnv('NOTE_CHAT_ID', '-100')
    const ctx = fakeContext(OWNER + 1)
    await sendInlineNote(ctx as never, OWNER)
    expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce()
    expect(ctx.api.editMessageTextInline).not.toHaveBeenCalled()
    expect(fetchDaily).not.toHaveBeenCalled()
  })

  it('brings the button back when the recording fails', async () => {
    vi.stubEnv('NOTE_CHAT_ID', '-100')
    vi.mocked(fetchDaily).mockRejectedValue(new Error('down'))
    const ctx = fakeContext(OWNER)
    await sendInlineNote(ctx as never, OWNER)
    const calls = ctx.api.editMessageTextInline.mock.calls as unknown[][]
    expect(calls).toHaveLength(2)
    expect(calls[1]![2]).toMatchObject({ reply_markup: expect.anything() })
  })
})
