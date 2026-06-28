/**
 * Applies Drizzle migrations using the postgres-js driver.
 * Run with: bun scripts/migrate.ts
 * (drizzle-kit's own `migrate` command swallows errors, so we do it ourselves.)
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.NUXT_DATABASE_URL ?? 'postgres://astro:astro@localhost:5433/astro'

const sql = postgres(url, { max: 1 })
const db = drizzle(sql)

try {
  await migrate(db, { migrationsFolder: './server/db/migrations' })
  console.log('✓ migrations applied')
} catch (err) {
  console.error('✗ migration failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
