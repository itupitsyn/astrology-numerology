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
import type { NatalChart, NumerologyResult } from '../../shared/types'

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
