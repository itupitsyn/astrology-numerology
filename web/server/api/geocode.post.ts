import { fetchGeocode } from '../utils/astro/client'
import type { GeocodeRequest } from '../utils/astro/types'

/**
 * POST /api/geocode — proxy to astro-service /geocode.
 * Body: { query: string, limit?: number, language?: string }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<GeocodeRequest>>(event)

  if (!body?.query || typeof body.query !== 'string' || !body.query.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'query is required' })
  }

  return fetchGeocode(event, {
    query: body.query.trim(),
    limit: typeof body.limit === 'number' ? body.limit : undefined,
    language: typeof body.language === 'string' ? body.language : undefined,
  })
})
