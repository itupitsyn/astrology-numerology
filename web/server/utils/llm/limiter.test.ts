import { describe, expect, it, vi } from 'vitest'
import { ConcurrencyLimiter, LlmBusyError } from './limiter'

/** A task that resolves only when told to. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('ConcurrencyLimiter', () => {
  it('runs up to the limit at once', async () => {
    const limiter = new ConcurrencyLimiter(2, 1000, 10)
    const a = deferred()
    const b = deferred()
    let started = 0

    const first = limiter.run(async () => {
      started++
      await a.promise
    })
    const second = limiter.run(async () => {
      started++
      await b.promise
    })

    await vi.waitFor(() => expect(started).toBe(2))
    a.resolve()
    b.resolve()
    await Promise.all([first, second])
  })

  it('queues work beyond the limit', async () => {
    const limiter = new ConcurrencyLimiter(1, 1000, 10)
    const first = deferred()
    let secondStarted = false

    const running = limiter.run(() => first.promise)
    const queued = limiter.run(async () => {
      secondStarted = true
    })

    // The second task must not have touched the GPU yet.
    await Promise.resolve()
    expect(secondStarted).toBe(false)
    expect(limiter.stats).toMatchObject({ active: 1, queued: 1 })

    first.resolve()
    await Promise.all([running, queued])
    expect(secondStarted).toBe(true)
    expect(limiter.stats).toMatchObject({ active: 0, queued: 0 })
  })

  it('rejects a caller that waits longer than the budget', async () => {
    const limiter = new ConcurrencyLimiter(1, 20, 10)
    const blocker = deferred()
    const running = limiter.run(() => blocker.promise)

    // Answering "busy" quickly is the point: a caller left hanging on a full
    // queue times out with nothing, having burned the wait for no result.
    await expect(limiter.run(async () => 'never')).rejects.toBeInstanceOf(LlmBusyError)

    blocker.resolve()
    await running
  })

  it('rejects immediately once the queue is full', async () => {
    const limiter = new ConcurrencyLimiter(1, 10_000, 1)
    const blocker = deferred()
    const running = limiter.run(() => blocker.promise)
    const queued = limiter.run(async () => 'queued')

    await expect(limiter.run(async () => 'overflow')).rejects.toBeInstanceOf(LlmBusyError)

    blocker.resolve()
    await Promise.all([running, queued])
  })

  it('releases the slot when the task throws', async () => {
    const limiter = new ConcurrencyLimiter(1, 1000, 10)
    await expect(
      limiter.run(async () => {
        throw new Error('LLM exploded')
      }),
    ).rejects.toThrow('LLM exploded')

    expect(limiter.stats).toMatchObject({ active: 0, queued: 0 })
    // The limiter must still be usable — a failed generation cannot wedge it.
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('does not leak slots under a burst', async () => {
    const limiter = new ConcurrencyLimiter(2, 5000, 100)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => limiter.run(async () => i)),
    )
    expect(results).toHaveLength(20)
    expect(limiter.stats).toMatchObject({ active: 0, queued: 0 })
  })

  it('holds a leased slot until it is explicitly released', async () => {
    // What streaming needs: the work happens while the caller iterates, so a
    // slot returned when the generator is merely created would let every
    // concurrent stream onto the one card at once.
    const limiter = new ConcurrencyLimiter(1, 50, 10)
    const release = await limiter.lease()

    expect(limiter.stats).toMatchObject({ active: 1 })
    await expect(limiter.run(async () => 'second')).rejects.toBeInstanceOf(LlmBusyError)

    release()
    await expect(limiter.run(async () => 'second')).resolves.toBe('second')
  })

  it('ignores a double release, so a finally cannot inflate the budget', async () => {
    const limiter = new ConcurrencyLimiter(1, 1000, 10)
    const release = await limiter.lease()
    release()
    release()
    release()
    expect(limiter.stats).toMatchObject({ active: 0 })
  })

  it('hands a released lease straight to whoever is waiting', async () => {
    const limiter = new ConcurrencyLimiter(1, 5000, 10)
    const release = await limiter.lease()

    let ran = false
    const queued = limiter.run(async () => {
      ran = true
      return 'ok'
    })

    await Promise.resolve()
    expect(ran).toBe(false)

    release()
    await expect(queued).resolves.toBe('ok')
  })

  it('treats a limit of zero as unlimited', async () => {
    const limiter = new ConcurrencyLimiter(0, 10, 1)
    const blocker = deferred()
    const running = limiter.run(() => blocker.promise)
    await expect(limiter.run(async () => 'through')).resolves.toBe('through')
    blocker.resolve()
    await running
  })
})
