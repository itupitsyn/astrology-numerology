/**
 * Persistence helpers for readings and their feedback.
 */

import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { readingFeedback, readings, type NewReading } from '../db/schema'
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
