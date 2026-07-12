/**
 * Shared parsing/validation for horary interpretation endpoints (stream + not).
 * Resolves the friendly category to a quesited house and builds the
 * astro-service HoraryQuestion payload.
 */

import type { HoraryQuestion } from './astro/types'
import { houseForCategory } from '../../shared/horary'

export interface HoraryInterpretationBody {
  question?: string
  /** Friendly category id (mapped to a house) — preferred UX path. */
  category?: string
  /** Or an explicit quesited house (1..12). */
  quesitedHouse?: number
  querentHouse?: number

  askNow?: boolean
  year?: number
  month?: number
  day?: number
  hour?: number
  minute?: number

  latitude?: number
  longitude?: number
  timezone?: string
  city?: string

  temperature?: number
  maxTokens?: number
  enableThinking?: boolean
}

export interface ParsedHorary {
  question: HoraryQuestion
  category: string | null
}

/** Validate the request body and build the astro-service question. Throws H3 errors. */
export function parseHoraryBody(body: HoraryInterpretationBody): ParsedHorary {
  if (typeof body?.question !== 'string' || body.question.trim().length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'question is required' })
  }
  for (const key of ['latitude', 'longitude'] as const) {
    if (typeof body?.[key] !== 'number') {
      throw createError({ statusCode: 400, statusMessage: `${key} is required and must be a number` })
    }
  }

  let quesitedHouse: number | null = null
  if (body.category) {
    quesitedHouse = houseForCategory(body.category)
    if (quesitedHouse == null) {
      throw createError({ statusCode: 400, statusMessage: `unknown category: ${body.category}` })
    }
  } else if (typeof body.quesitedHouse === 'number') {
    quesitedHouse = body.quesitedHouse
  }
  if (quesitedHouse == null || quesitedHouse < 1 || quesitedHouse > 12) {
    throw createError({ statusCode: 400, statusMessage: 'a valid category or quesitedHouse (1..12) is required' })
  }

  const question: HoraryQuestion = {
    question: body.question.trim(),
    quesited_house: quesitedHouse,
    querent_house: body.querentHouse ?? 1,
    ask_now: body.askNow ?? false,
    year: body.year ?? null,
    month: body.month ?? null,
    day: body.day ?? null,
    hour: body.hour ?? null,
    minute: body.minute ?? null,
    latitude: body.latitude!,
    longitude: body.longitude!,
    timezone: body.timezone ?? null,
    city: body.city ?? null,
  }

  return { question, category: body.category ?? null }
}
