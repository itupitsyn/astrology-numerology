import { requireTelegramUser } from '../utils/auth'
import { isValidTimezone } from '../utils/localDate'
import { upsertProfile, type ProfileInput } from '../utils/profiles'

interface PlaceBody {
  latitude?: number
  longitude?: number
  timezone?: string | null
  city?: string | null
}

interface ProfileBody {
  name?: string | null
  fullName?: string | null
  year?: number
  month?: number
  day?: number
  hour?: number
  minute?: number
  /** True when the user does not know their birth time. */
  birthTimeUnknown?: boolean
  /** Birth place — from /api/geocode, which also supplies the timezone. */
  birthPlace?: PlaceBody
  /** Where the user lives now. Omit to reuse the birth place. */
  currentPlace?: PlaceBody
}

function integerInRange(value: unknown, min: number, max: number, field: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an integer between ${min} and ${max}`,
    })
  }
  return n
}

function coordinate(value: unknown, limit: number, field: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < -limit || n > limit) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be between ${-limit} and ${limit}` })
  }
  return n
}

/**
 * POST /api/profile
 *
 * Writes the data a user is asked for exactly once. Identity comes from the
 * signed Telegram `initData`, never from the request body — so a caller cannot
 * write into someone else's profile.
 *
 * The timezone is required rather than inferred: it is what defines the user's
 * day, and /api/geocode returns it with every result, so the form always has
 * it. Guessing here would silently shift a forecast by a day near midnight.
 */
export default defineEventHandler(async (event) => {
  const telegramUser = requireTelegramUser(event)
  const body = await readBody<ProfileBody>(event)

  const birthPlace = body?.birthPlace
  if (!birthPlace) {
    throw createError({ statusCode: 400, statusMessage: 'birthPlace is required' })
  }

  const birthTimezone = birthPlace.timezone ?? null
  if (!birthTimezone || !isValidTimezone(birthTimezone)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'birthPlace.timezone is required and must be a valid IANA timezone',
    })
  }

  const current = body?.currentPlace
  let placeTimezone: string | null = null
  if (current && current.latitude != null && current.longitude != null) {
    placeTimezone = current.timezone ?? null
    if (!placeTimezone || !isValidTimezone(placeTimezone)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'currentPlace.timezone is required and must be a valid IANA timezone',
      })
    }
  }

  // With no birth time we store a placeholder of noon and flag it, so nothing
  // downstream can mistake it for a real one. The flag — not the hour — is what
  // switches houses and the angles off.
  const birthTimeUnknown = body?.birthTimeUnknown === true

  const input: ProfileInput = {
    telegramId: telegramUser.id,
    name: body?.name?.trim() || telegramUser.first_name || null,
    fullName: body?.fullName?.trim() || null,

    birthYear: integerInRange(body?.year, 1, 3000, 'year'),
    birthMonth: integerInRange(body?.month, 1, 12, 'month'),
    birthDay: integerInRange(body?.day, 1, 31, 'day'),
    birthHour: birthTimeUnknown ? 12 : integerInRange(body?.hour, 0, 23, 'hour'),
    birthMinute: birthTimeUnknown ? 0 : integerInRange(body?.minute, 0, 59, 'minute'),
    birthTimeUnknown,
    birthLatitude: coordinate(birthPlace.latitude, 90, 'birthPlace.latitude'),
    birthLongitude: coordinate(birthPlace.longitude, 180, 'birthPlace.longitude'),
    birthTimezone,
    birthCity: birthPlace.city ?? null,

    placeLatitude: placeTimezone ? coordinate(current!.latitude, 90, 'currentPlace.latitude') : null,
    placeLongitude: placeTimezone ? coordinate(current!.longitude, 180, 'currentPlace.longitude') : null,
    placeTimezone,
    placeCity: placeTimezone ? (current!.city ?? null) : null,
  }

  const profile = await upsertProfile(input)

  return {
    id: profile.id,
    version: profile.version,
    birthTimeUnknown: profile.birthTimeUnknown,
    // Echo the effective day-defining zone so the form can show what it saved.
    timezone: profile.placeTimezone ?? profile.birthTimezone,
    updatedAt: profile.updatedAt,
  }
})
