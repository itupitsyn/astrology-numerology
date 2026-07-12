/**
 * Persistence helpers for readings and their feedback.
 */

import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  horaryFeedback,
  horaryReadings,
  readingFeedback,
  readings,
  type NewHoraryReading,
  type NewReading,
} from '../db/schema'
import { useDb } from './db'

/** Short, URL-safe, unguessable id for share links (/r/:id). */
export function newReadingId(): string {
  return nanoid(12)
}

export async function saveReading(data: NewReading) {
  const [row] = await useDb().insert(readings).values(data).returning()
  return row
}

export async function getReading(id: string) {
  return useDb().query.readings.findFirst({
    where: eq(readings.id, id),
    with: { feedback: { orderBy: (f) => desc(f.createdAt), limit: 1 } },
  })
}

export async function saveFeedback(readingId: string, rating: number, comment?: string) {
  const [row] = await useDb()
    .insert(readingFeedback)
    .values({ id: nanoid(12), readingId, rating, comment })
    .returning()
  return row
}

// --- Horary ---------------------------------------------------------------

/** Short, URL-safe, unguessable id for horary share links (/h/:id). */
export function newHoraryId(): string {
  return nanoid(12)
}

export async function saveHoraryReading(data: NewHoraryReading) {
  const [row] = await useDb().insert(horaryReadings).values(data).returning()
  return row
}

export async function getHoraryReading(id: string) {
  return useDb().query.horaryReadings.findFirst({
    where: eq(horaryReadings.id, id),
    with: { feedback: { orderBy: (f) => desc(f.createdAt), limit: 1 } },
  })
}

export async function saveHoraryFeedback(horaryId: string, rating: number, comment?: string) {
  const [row] = await useDb()
    .insert(horaryFeedback)
    .values({ id: nanoid(12), horaryId, rating, comment })
    .returning()
  return row
}
