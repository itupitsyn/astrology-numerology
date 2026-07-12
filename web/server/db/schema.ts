/**
 * Drizzle schema. Two tables:
 *  - readings:         one generated interpretation = one row (also the share artifact)
 *  - reading_feedback: 👍/👎 ratings, the fuel for model/prompt A/B testing
 */

import { relations } from 'drizzle-orm'
import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
// Relative path (not the ~~ alias) so drizzle-kit can resolve it too.
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
