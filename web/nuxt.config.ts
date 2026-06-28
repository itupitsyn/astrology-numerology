// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

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
    },
  },
})
