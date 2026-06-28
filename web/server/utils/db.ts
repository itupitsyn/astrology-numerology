/**
 * Singleton Drizzle/Postgres connection for Nitro.
 * Lazily initialised on first use; reused across requests.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function useDb() {
  if (!_db) {
    const { databaseUrl } = useRuntimeConfig()
    const client = postgres(databaseUrl, { max: 5 })
    _db = drizzle(client, { schema })
  }
  return _db
}
