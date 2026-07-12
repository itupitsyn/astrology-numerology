/**
 * Server-side client for the Python astro-service.
 *
 * Nitro is the only thing that talks to astro-service — the browser never does.
 * Errors are normalised: a down service becomes 502, while validation errors
 * from FastAPI (4xx) are propagated with their detail message.
 */

import type { H3Event } from 'h3'
import { FetchError } from 'ofetch'
import type {
  BirthData,
  GeocodeRequest,
  GeocodeResponse,
  HoraryChart,
  HoraryQuestion,
  NatalChart,
} from './types'

function astroBaseUrl(event: H3Event): string {
  return useRuntimeConfig(event).astroServiceUrl
}

async function callAstro<T>(event: H3Event, path: string, body: unknown): Promise<T> {
  try {
    return await $fetch<T>(path, {
      baseURL: astroBaseUrl(event),
      method: 'POST',
      body,
    })
  } catch (err) {
    if (err instanceof FetchError && err.response) {
      // astro-service responded with an error status — forward it.
      const detail = (err.data as { detail?: string } | undefined)?.detail
      throw createError({
        statusCode: err.response.status,
        statusMessage: detail || err.response.statusText || 'astro-service error',
      })
    }
    // No response at all — connection refused / timeout / DNS.
    throw createError({
      statusCode: 502,
      statusMessage: 'astro-service is unreachable',
    })
  }
}

export function fetchNatalChart(event: H3Event, body: BirthData): Promise<NatalChart> {
  return callAstro<NatalChart>(event, '/natal', body)
}

export function fetchGeocode(event: H3Event, body: GeocodeRequest): Promise<GeocodeResponse> {
  return callAstro<GeocodeResponse>(event, '/geocode', body)
}

export function fetchHoraryChart(event: H3Event, body: HoraryQuestion): Promise<HoraryChart> {
  return callAstro<HoraryChart>(event, '/horary', body)
}
