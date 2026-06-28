import { fetchNatalChart } from '../utils/astro/client'
import type { BirthData } from '../utils/astro/types'

const REQUIRED_NUMBERS = ['year', 'month', 'day', 'hour', 'minute', 'latitude', 'longitude'] as const

/**
 * POST /api/natal — proxy to astro-service /natal.
 * Body: BirthData (year, month, day, hour, minute, latitude, longitude, ...).
 * `timezone` is optional; astro-service resolves it from coordinates if absent.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<BirthData>>(event)

  for (const key of REQUIRED_NUMBERS) {
    if (typeof body?.[key] !== 'number') {
      throw createError({ statusCode: 400, statusMessage: `${key} is required and must be a number` })
    }
  }

  return fetchNatalChart(event, body as BirthData)
})
