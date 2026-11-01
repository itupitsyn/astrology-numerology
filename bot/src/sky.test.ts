import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, requestSky: vi.fn(), pollSky: vi.fn(), fetchSkyVideo: vi.fn(), skySent: vi.fn(async () => ({ ok: true })) }
})

const { fetchSkyVideo, requestSky, skySent } = await import('./api')
const { sendSky } = await import('./sky')

function fakeContext(type = 'supergroup') {
  return {
    chat: { id: 77, type },
    me: { username: 'astro_bot' },
    reply: vi.fn(async () => ({})),
    replyWithChatAction: vi.fn(async () => true),
    replyWithVideoNote: vi.fn(async () => ({ video_note: { file_id: 'new-file' } })),
  }
}

describe('sendSky', () => {
  afterEach(() => vi.clearAllMocks())

  it('resends a recorded note by file_id, with nothing else in the chat', async () => {
    vi.mocked(requestSky).mockResolvedValue({ id: 's1', status: 'ready', fileId: 'old-file', error: null })
    const ctx = fakeContext()
    await sendSky(ctx as never)
    expect(ctx.replyWithVideoNote).toHaveBeenCalledOnce()
    expect((ctx.replyWithVideoNote.mock.calls as unknown[][])[0]![0]).toBe('old-file')
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('uploads a fresh render and keeps its file_id for the other chats', async () => {
    vi.mocked(requestSky).mockResolvedValue({ id: 's1', status: 'rendered', fileId: null, error: null })
    vi.mocked(fetchSkyVideo).mockResolvedValue(new Uint8Array([1]))
    const ctx = fakeContext()
    await sendSky(ctx as never)
    expect(skySent).toHaveBeenCalledWith('s1', 'new-file')
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('says so when the note failed, and offers the personal forecast only in groups', async () => {
    vi.mocked(requestSky).mockResolvedValue({ id: 's1', status: 'failed', fileId: null, error: 'x' })
    const failed = fakeContext()
    await sendSky(failed as never)
    expect(failed.reply).toHaveBeenCalledOnce()

    vi.mocked(requestSky).mockResolvedValue({ id: 's1', status: 'ready', fileId: 'f', error: null })
    const group = fakeContext()
    await sendSky(group as never)
    expect((group.replyWithVideoNote.mock.calls as unknown[][])[0]![1]).toMatchObject({ reply_markup: expect.anything() })
    const personal = fakeContext('private')
    await sendSky(personal as never)
    expect((personal.replyWithVideoNote.mock.calls as unknown[][])[0]![1]).toMatchObject({ reply_markup: undefined })
  })
})
