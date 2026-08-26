/**
 * Access to the Telegram Mini App bridge.
 *
 * `initData` is the signed payload the Telegram client hands the page; the
 * server verifies its HMAC against the bot token and takes the user id from
 * there. That is why nothing here ever sends a user id of its own — a caller
 * must not be able to name whose profile it is writing.
 *
 * The bridge script is loaded by the page that needs it, so on first mount we
 * wait briefly for `window.Telegram` to appear before deciding it is absent.
 */

interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } }
  ready: () => void
  expand: () => void
  close: () => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

const BRIDGE_TIMEOUT_MS = 3000
const POLL_MS = 50

export function useTelegram() {
  const webApp = shallowRef<TelegramWebApp | null>(null)
  const initData = ref('')
  /** Null while we are still waiting for the bridge to load. */
  const inside = ref<boolean | null>(null)

  const firstName = computed(() => webApp.value?.initDataUnsafe?.user?.first_name ?? '')

  onMounted(async () => {
    const deadline = Date.now() + BRIDGE_TIMEOUT_MS
    while (Date.now() < deadline) {
      const app = window.Telegram?.WebApp
      // An empty initData means the page was opened outside Telegram (or in a
      // context Telegram refuses to sign) — the script alone is not enough.
      if (app?.initData) {
        app.ready()
        app.expand()
        webApp.value = app
        initData.value = app.initData
        inside.value = true
        return
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
    inside.value = false
  })

  /** Headers that authenticate a request as this Telegram user. */
  const authHeaders = computed<Record<string, string>>(() =>
    initData.value ? { 'X-Telegram-Init-Data': initData.value } : {},
  )

  function close() {
    webApp.value?.close()
  }

  return { webApp, initData, inside, firstName, authHeaders, close }
}
