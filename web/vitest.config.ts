import { defineConfig } from 'vitest/config'

// Pure unit tests for server-side domain logic (no Nuxt runtime needed).
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    environment: 'node',
  },
})
