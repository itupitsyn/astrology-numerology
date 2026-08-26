/**
 * Profile persistence — the data a bot user supplies exactly once.
 *
 * The profile is owned by this service rather than by the bot: the web app that
 * collects it already talks to this database, and the daily cache is keyed on
 * the profile's identity and version.
 */

import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { profiles, type Profile } from '../db/schema'
import type { PlaceRef } from './astro/daily'
import type { BirthData } from './astro/types'
import { useDb } from './db'
import { isValidTimezone } from './localDate'

export interface ProfileInput {
  telegramId: number
  name?: string | null
  fullName?: string | null

  birthYear: number
  birthMonth: number
  birthDay: number
  birthHour: number
  birthMinute: number
  birthLatitude: number
  birthLongitude: number
  birthTimezone?: string | null
  birthCity?: string | null
  /** True when the birth time is unknown; hour/minute then hold a placeholder. */
  birthTimeUnknown?: boolean

  placeLatitude?: number | null
  placeLongitude?: number | null
  placeTimezone?: string | null
  placeCity?: string | null
}

export function newProfileId(): string {
  return nanoid(12)
}

/**
 * Fingerprint of everything that changes the computed sky.
 *
 * Deliberately excludes cosmetic fields (names, city labels): renaming yourself
 * must not throw away today's generated text. Coordinates are rounded to ~10 m,
 * so a geocoder returning a hair-different value for the same place does not
 * invalidate the cache either.
 */
export function profileVersion(input: ProfileInput): string {
  const round = (n: number) => Number(n.toFixed(4))
  const material = [
    input.birthYear, input.birthMonth, input.birthDay,
    input.birthHour, input.birthMinute,
    round(input.birthLatitude), round(input.birthLongitude),
    input.birthTimezone ?? '',
    // Toggling "I don't know my birth time" changes what is computed at all,
    // so it has to invalidate a cached reading.
    input.birthTimeUnknown ? 'no-time' : 'time',
    input.placeLatitude == null ? '' : round(input.placeLatitude),
    input.placeLongitude == null ? '' : round(input.placeLongitude),
    input.placeTimezone ?? '',
  ].join('|')
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}

export async function getProfileByTelegramId(telegramId: number): Promise<Profile | undefined> {
  return useDb().query.profiles.findFirst({ where: eq(profiles.telegramId, telegramId) })
}

export async function getProfileById(id: string): Promise<Profile | undefined> {
  return useDb().query.profiles.findFirst({ where: eq(profiles.id, id) })
}

/**
 * Create or replace the profile for a Telegram user.
 *
 * `id` is preserved across updates so previously generated readings stay linked
 * to their owner; only `version` changes, which is what marks them stale.
 */
export async function upsertProfile(input: ProfileInput): Promise<Profile> {
  const version = profileVersion(input)
  const values = {
    ...input,
    name: input.name ?? null,
    fullName: input.fullName ?? null,
    birthTimeUnknown: input.birthTimeUnknown ?? false,
    version,
    updatedAt: new Date(),
  }

  const [row] = await useDb()
    .insert(profiles)
    .values({ id: newProfileId(), ...values })
    .onConflictDoUpdate({ target: profiles.telegramId, set: values })
    .returning()
  return row!
}

/** The natal half of the profile, in the shape astro-service expects. */
export function profileBirthData(profile: Profile): BirthData {
  return {
    name: profile.name ?? 'Subject',
    year: profile.birthYear,
    month: profile.birthMonth,
    day: profile.birthDay,
    hour: profile.birthHour,
    minute: profile.birthMinute,
    latitude: profile.birthLatitude,
    longitude: profile.birthLongitude,
    timezone: profile.birthTimezone,
    city: profile.birthCity,
  }
}

/** Where the person is now. Falls back to the birth place when unset. */
export function profilePlace(profile: Profile): PlaceRef {
  const hasPlace = profile.placeLatitude != null && profile.placeLongitude != null
  return hasPlace
    ? {
        latitude: profile.placeLatitude!,
        longitude: profile.placeLongitude!,
        timezone: profile.placeTimezone,
        city: profile.placeCity,
      }
    : {
        latitude: profile.birthLatitude,
        longitude: profile.birthLongitude,
        timezone: profile.birthTimezone,
        city: profile.birthCity,
      }
}

/**
 * The timezone that defines this user's day.
 *
 * Only an explicitly known zone is trusted here. If the profile carries none,
 * the caller must resolve it from coordinates (astro-service does that offline)
 * rather than guessing — a wrong zone silently shifts the whole forecast by a
 * day near midnight.
 */
export function profileTimezone(profile: Profile): string | null {
  const place = profilePlace(profile)
  const zone = place.timezone ?? null
  return zone && isValidTimezone(zone) ? zone : null
}
