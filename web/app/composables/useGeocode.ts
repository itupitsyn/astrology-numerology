import type { GeocodeResponse, GeoLocation } from '~~/shared/types'

/**
 * Debounced city search against /api/geocode (which proxies to astro-service).
 */
export function useGeocode() {
  const results = ref<GeoLocation[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0

  async function run(query: string) {
    const current = ++seq
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<GeocodeResponse>('/api/geocode', {
        method: 'POST',
        body: { query, limit: 6 },
      })
      if (current === seq) results.value = res.results
    } catch (e) {
      if (current === seq) {
        error.value = e instanceof Error ? e.message : 'Не удалось найти город'
        results.value = []
      }
    } finally {
      if (current === seq) loading.value = false
    }
  }

  function search(query: string, delay = 350) {
    if (timer) clearTimeout(timer)
    const q = query.trim()
    if (q.length < 2) {
      results.value = []
      loading.value = false
      return
    }
    // Show the loader immediately (during the debounce window too) so the user
    // isn't left wondering whether anything is happening.
    loading.value = true
    timer = setTimeout(() => run(q), delay)
  }

  function clear() {
    if (timer) clearTimeout(timer)
    results.value = []
    error.value = null
    loading.value = false
  }

  return { results, loading, error, search, clear }
}
