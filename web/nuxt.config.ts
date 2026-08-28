// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  app: {
    head: {
      title: 'Астро-нумерология',
      link: [
        // SVG for modern browsers; .ico fallback for the rest.
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'alternate icon', type: 'image/x-icon', href: '/favicon.ico' },
      ],
    },
  },

  runtimeConfig: {
    // Base URL of the Python astro-service. Override in prod with the env var
    // NUXT_ASTRO_SERVICE_URL. Server-only (not exposed to the client).
    astroServiceUrl: 'http://127.0.0.1:8000',

    // PostgreSQL connection. Override with NUXT_DATABASE_URL.
    // Port 5433: our Docker Postgres (5432 is taken by a native install).
    databaseUrl: 'postgres://astro:astro@localhost:5433/astro',

    // LLM (llama.cpp, OpenAI-compatible). Values come from env only — no
    // endpoint is committed to the repo. Set NUXT_LLM_BASE_URL (and optionally
    // NUXT_LLM_API_KEY). The model id is auto-detected from /v1/models.
    llm: {
      baseUrl: '',
      apiKey: '', // sent as Bearer if set

      // Outbound budget: match the llama.cpp server's `--parallel N`, readable
      // from its /props as `total_slots`. Set it lower and spare slots idle
      // while users queue here; set it higher and the excess queues invisibly
      // inside llama.cpp, where nothing bounds it and everything times out
      // together. 1 is the safe default for an unknown server — override with
      // NUXT_LLM_CONCURRENCY.
      concurrency: 1,
      queueMaxWaitMs: 60_000,
      queueMaxSize: 50,
    },

    // Shared secret for the bot's server-to-server calls (/api/bot/*). Required
    // for those routes: they can start a GPU job, so they are not left open.
    // Set NUXT_BOT_API_KEY.
    botApiKey: '',

    // Telegram bot token. Used only to verify Mini App `initData` signatures,
    // which is how /api/profile learns who is calling. Set NUXT_TELEGRAM_BOT_TOKEN.
    telegramBotToken: '',

    // Public origin of this app, used to build the setup link the bot sends a
    // user who has no profile yet. Set NUXT_APP_URL.
    appUrl: 'http://localhost:3000',
  },
})
