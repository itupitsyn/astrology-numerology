/**
 * Outbound concurrency budget for the LLM.
 *
 * The model runs on one GPU. Without a budget, ten simultaneous users all post
 * to llama.cpp at once, every request queues *inside* the server where nothing
 * can see or bound it, and they all time out together — the worst possible
 * failure, because the work is done and then thrown away.
 *
 * Same shape as the geocoding limiter in `astro-service/geocoding.py`: a FIFO
 * queue with a hard cap on how long a caller may wait, so an overloaded service
 * answers "busy, retry" quickly instead of letting callers pile up.
 *
 * Per-process, and exact only while Nitro runs a single instance — which is how
 * the Dockerfile starts it. Scaling out horizontally would need a shared lock.
 */

/** Thrown when the queue is full or the wait budget is exhausted. */
export class LlmBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmBusyError'
  }
}

interface Waiter {
  resolve: () => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class ConcurrencyLimiter {
  private active = 0
  private queue: Waiter[] = []

  constructor(
    private readonly limit: number,
    private readonly maxWaitMs: number,
    private readonly maxQueue: number,
  ) {}

  get stats() {
    return { active: this.active, queued: this.queue.length, limit: this.limit }
  }

  private acquire(): Promise<void> {
    if (this.limit <= 0 || this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(
        new LlmBusyError(`LLM queue is full (${this.queue.length} waiting)`),
      )
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          // Drop out of the queue rather than being handed a slot later: by now
          // the caller has almost certainly given up on us.
          const index = this.queue.indexOf(waiter)
          if (index >= 0) this.queue.splice(index, 1)
          reject(new LlmBusyError(`waited ${this.maxWaitMs}ms for an LLM slot`))
        }, this.maxWaitMs),
      }
      this.queue.push(waiter)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      // Hand the slot straight over — `active` stays as it is.
      clearTimeout(next.timer)
      next.resolve()
      return
    }
    this.active = Math.max(0, this.active - 1)
  }

  /**
   * Take a slot and get back the function that returns it.
   *
   * For streaming, where the work happens while the caller iterates rather than
   * inside a single promise: `run` would hand the slot back the moment the
   * generator was *created*, letting every concurrent stream through at once —
   * which is exactly the pile-up the budget exists to prevent.
   *
   * Releasing twice is a no-op, so a `finally` that also runs on the happy path
   * cannot over-release and inflate the budget.
   */
  async lease(): Promise<() => void> {
    await this.acquire()
    let released = false
    return () => {
      if (released) return
      released = true
      this.release()
    }
  }

  /** Run `fn` holding one slot. The slot is always released. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.lease()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

let _limiter: ConcurrencyLimiter | null = null

/** Process-wide LLM limiter, configured from runtimeConfig on first use. */
export function useLlmLimiter(): ConcurrencyLimiter {
  if (!_limiter) {
    const { llm } = useRuntimeConfig()
    _limiter = new ConcurrencyLimiter(
      Number(llm.concurrency ?? 1),
      Number(llm.queueMaxWaitMs ?? 60_000),
      Number(llm.queueMaxSize ?? 50),
    )
  }
  return _limiter
}

/** Convenience wrapper: run `fn` within the LLM budget. */
export function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  return useLlmLimiter().run(fn)
}

/** Take a slot for a streamed generation; call the result when the stream ends. */
export function leaseLlmSlot(): Promise<() => void> {
  return useLlmLimiter().lease()
}
