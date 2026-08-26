/**
 * Boot-time check that the database schema is actually migrated.
 *
 * Without it, a database that is merely *reachable* but not migrated fails at
 * request time as a bare 500 — and in production the stack trace is hidden, so
 * the only clue is "Server Error" on whichever page happened to be opened. That
 * is a long way from "you forgot to run the migrations".
 *
 * Warn-only, never fatal: a slow-starting database must not take the app down,
 * and this is a diagnostic, not a gate.
 */

import { sql } from 'drizzle-orm'
import { useDb } from '../utils/db'

export default defineNitroPlugin(() => {
  // Detached: nothing should block the server from accepting connections.
  void verifySchema()
})

async function verifySchema(): Promise<void> {
  try {
    // Touches the newest migration's column on the newest migration's table, so
    // a partially-applied history is caught too, not just a completely empty DB.
    await useDb().execute(sql`select "birth_time_unknown" from "profiles" limit 1`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      [
        '',
        '  ⚠  The database schema is missing or out of date.',
        '',
        `     ${message.split('\n')[0]}`,
        '',
        '     Apply the migrations:',
        '       docker compose run --rm migrate',
        '     or, running the web layer directly:',
        '       cd web && bun run db:migrate',
        '',
        '     Until then /api/profile and /api/bot/* answer 500.',
        '',
      ].join('\n'),
    )
  }
}
