import { requireTelegramUser } from '../utils/auth'
import { getProfileByTelegramId } from '../utils/profiles'

/**
 * GET /api/profile
 *
 * Prefill for the setup form. Returns `null` rather than 404 when the user has
 * no profile yet — "you have not filled this in" is the normal first case here,
 * not an error. (Nitro sends that null as a 204 with an empty body, which
 * `$fetch` surfaces as a falsy value; the form treats it as "new user".)
 */
export default defineEventHandler(async (event) => {
  const telegramUser = requireTelegramUser(event)
  const profile = await getProfileByTelegramId(telegramUser.id)
  if (!profile) return null

  return {
    id: profile.id,
    name: profile.name,
    fullName: profile.fullName,
    year: profile.birthYear,
    month: profile.birthMonth,
    day: profile.birthDay,
    hour: profile.birthHour,
    minute: profile.birthMinute,
    birthTimeUnknown: profile.birthTimeUnknown,
    birthPlace: {
      latitude: profile.birthLatitude,
      longitude: profile.birthLongitude,
      timezone: profile.birthTimezone,
      city: profile.birthCity,
    },
    currentPlace:
      profile.placeLatitude != null && profile.placeLongitude != null
        ? {
            latitude: profile.placeLatitude,
            longitude: profile.placeLongitude,
            timezone: profile.placeTimezone,
            city: profile.placeCity,
          }
        : null,
    updatedAt: profile.updatedAt,
  }
})
