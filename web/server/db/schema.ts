/**
 * Drizzle schema.
 *
 *  - readings / reading_feedback:              natal + numerology interpretations
 *  - horary_readings / horary_feedback:        one judged question each
 *  - profiles:                                 who the bot's users are (asked once)
 *  - daily_readings / daily_feedback:          one forecast per user per local day
 */

import { relations } from 'drizzle-orm'
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
// Relative path (not the ~~ alias) so drizzle-kit can resolve it too.
import type { DailyForecast } from '../utils/astro/daily'
import type { HoraryChart, NatalChart, NumerologyResult } from '../../shared/types'

export const readings = pgTable('readings', {
  // Short unguessable id (nanoid) — used directly in the share URL /r/:id.
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  // --- input (personal data) ---
  name: text('name'),
  fullName: text('full_name'),
  city: text('city'),
  birthYear: integer('birth_year').notNull(),
  birthMonth: integer('birth_month').notNull(),
  birthDay: integer('birth_day').notNull(),
  birthHour: integer('birth_hour').notNull(),
  birthMinute: integer('birth_minute').notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  timezone: text('timezone'),
  targetYear: integer('target_year'),
  focus: text('focus'),

  // --- result snapshot (so /r/:id renders without recompute or GPU) ---
  chart: jsonb('chart').$type<NatalChart>().notNull(),
  numerology: jsonb('numerology').$type<NumerologyResult>().notNull(),
  interpretation: text('interpretation').notNull(),

  // --- A/B metadata ---
  model: text('model'),
  promptVersion: text('prompt_version'),
  usage: jsonb('usage').$type<Record<string, number>>(),
})

export const readingFeedback = pgTable('reading_feedback', {
  id: text('id').primaryKey(),
  readingId: text('reading_id')
    .notNull()
    .references(() => readings.id, { onDelete: 'cascade' }),
  rating: smallint('rating').notNull(), // 1 = 👍, -1 = 👎
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const readingsRelations = relations(readings, ({ many }) => ({
  feedback: many(readingFeedback),
}))

export const readingFeedbackRelations = relations(readingFeedback, ({ one }) => ({
  reading: one(readings, {
    fields: [readingFeedback.readingId],
    references: [readings.id],
  }),
}))

export type Reading = typeof readings.$inferSelect
export type NewReading = typeof readings.$inferInsert
export type ReadingFeedback = typeof readingFeedback.$inferSelect

// --- Horary ---------------------------------------------------------------
// A horary reading = one question judged at a moment. Separate table from
// `readings` because the shape differs (a question + verdict, no birth data or
// numerology). `verdict`/`perfectionMode` are denormalised out of the snapshot
// for cheap listing and A/B filtering.
export const horaryReadings = pgTable('horary_readings', {
  // Short unguessable id (nanoid) — used directly in the share URL /h/:id.
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  // --- input ---
  question: text('question').notNull(),
  category: text('category'), // friendly category id, if the picker was used
  quesitedHouse: integer('quesited_house').notNull(),
  querentHouse: integer('querent_house').notNull(),
  city: text('city'),
  momentUtc: text('moment_utc'),
  momentLocal: text('moment_local'),
  timezone: text('timezone'),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),

  // --- verdict (denormalised for listing / A/B) ---
  verdict: text('verdict').notNull(), // 'yes' | 'no' | 'qualified'
  perfectionMode: text('perfection_mode'),

  // --- result snapshot (so /h/:id renders without recompute) ---
  horary: jsonb('horary').$type<HoraryChart>().notNull(),
  interpretation: text('interpretation').notNull(),

  // --- A/B metadata ---
  model: text('model'),
  promptVersion: text('prompt_version'),
  usage: jsonb('usage').$type<Record<string, number>>(),
})

export const horaryFeedback = pgTable('horary_feedback', {
  id: text('id').primaryKey(),
  horaryId: text('horary_id')
    .notNull()
    .references(() => horaryReadings.id, { onDelete: 'cascade' }),
  rating: smallint('rating').notNull(), // 1 = 👍, -1 = 👎
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const horaryReadingsRelations = relations(horaryReadings, ({ many }) => ({
  feedback: many(horaryFeedback),
}))

export const horaryFeedbackRelations = relations(horaryFeedback, ({ one }) => ({
  reading: one(horaryReadings, {
    fields: [horaryFeedback.horaryId],
    references: [horaryReadings.id],
  }),
}))

export type HoraryReading = typeof horaryReadings.$inferSelect
export type NewHoraryReading = typeof horaryReadings.$inferInsert
export type HoraryFeedbackRow = typeof horaryFeedback.$inferSelect

// --- Profiles -------------------------------------------------------------
// The data a bot user is asked for exactly once, in the web app. It lives here
// rather than in the bot's own store for two reasons: the web app that collects
// it already talks to this database, and the daily cache is keyed on it — a
// profile shipped in each request body would make the cache key a hash of
// whatever JSON the caller happened to send, so a stray whitespace change in a
// city name would silently trigger a fresh (expensive) generation.
export const profiles = pgTable('profiles', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

  // Telegram numeric user id. Well under 2^53, so a JS number is exact.
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),

  name: text('name'),
  fullName: text('full_name'),

  // --- birth data (fixes the natal chart) ---
  birthYear: integer('birth_year').notNull(),
  birthMonth: integer('birth_month').notNull(),
  birthDay: integer('birth_day').notNull(),
  birthHour: integer('birth_hour').notNull(),
  birthMinute: integer('birth_minute').notNull(),
  birthLatitude: doublePrecision('birth_latitude').notNull(),
  birthLongitude: doublePrecision('birth_longitude').notNull(),
  birthTimezone: text('birth_timezone'),
  birthCity: text('birth_city'),
  // Set when the user said they do not know their birth time. The hour/minute
  // above then hold a placeholder (noon) and must never be used to derive
  // houses or the angles: those sweep the whole zodiac in 24 hours, so a guess
  // there is not an approximation, it is a fabrication.
  birthTimeUnknown: boolean('birth_time_unknown').default(false).notNull(),

  // --- current location (fixes the day boundary and every local event time) ---
  placeLatitude: doublePrecision('place_latitude'),
  placeLongitude: doublePrecision('place_longitude'),
  placeTimezone: text('place_timezone'),
  placeCity: text('place_city'),

  // Fingerprint of every field above that changes the sky. A cached forecast
  // whose version no longer matches is stale and gets recomputed — which is how
  // "I moved city" invalidates today's reading.
  version: text('version').notNull(),
})

export type Profile = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert

// --- Daily forecasts ------------------------------------------------------
// One row per user per local day, claimed before generation rather than after.
// The unique index is load-bearing: it is what stops two taps (or two chats)
// from both starting a generation on a single GPU.
export const dailyReadings = pgTable(
  'daily_readings',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    // Local calendar date at the profile's current place, as YYYY-MM-DD.
    localDate: text('local_date').notNull(),
    timezone: text('timezone').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // When the current generation attempt took the slot. A 'pending' row older
    // than the stale timeout is assumed dead (process restart) and reclaimed.
    claimedAt: timestamp('claimed_at', { withTimezone: true }).defaultNow().notNull(),

    // 'pending' — facts are ready, the text is still generating
    // 'ready'   — text is done
    // 'failed'  — generation failed; the next request reclaims and retries
    status: text('status').notNull(),
    profileVersion: text('profile_version').notNull(),

    // --- the deterministic half: computed without a GPU, available instantly ---
    forecast: jsonb('forecast').$type<DailyForecast>(),
    numerology: jsonb('numerology').$type<NumerologyResult>(),

    // --- the generated half ---
    interpretation: text('interpretation'),
    error: text('error'),

    // --- A/B metadata ---
    model: text('model'),
    promptVersion: text('prompt_version'),
    usage: jsonb('usage').$type<Record<string, number>>(),
  },
  (table) => [uniqueIndex('daily_readings_profile_date').on(table.profileId, table.localDate)],
)

export const dailyFeedback = pgTable('daily_feedback', {
  id: text('id').primaryKey(),
  dailyId: text('daily_id')
    .notNull()
    .references(() => dailyReadings.id, { onDelete: 'cascade' }),
  rating: smallint('rating').notNull(), // 1 = 👍, -1 = 👎
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const profilesRelations = relations(profiles, ({ many }) => ({
  daily: many(dailyReadings),
}))

export const dailyReadingsRelations = relations(dailyReadings, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [dailyReadings.profileId],
    references: [profiles.id],
  }),
  feedback: many(dailyFeedback),
}))

export const dailyFeedbackRelations = relations(dailyFeedback, ({ one }) => ({
  reading: one(dailyReadings, {
    fields: [dailyFeedback.dailyId],
    references: [dailyReadings.id],
  }),
}))

export type DailyReading = typeof dailyReadings.$inferSelect
export type NewDailyReading = typeof dailyReadings.$inferInsert
export type DailyFeedbackRow = typeof dailyFeedback.$inferSelect
