/**
 * Local calendar dates in an arbitrary IANA timezone.
 *
 * A daily forecast is defined by the user's *own* day, not the server's. Slice
 * it at the server's midnight and a user in Vladivostok reading at 09:00 gets
 * yesterday's sky, while a user in Lisbon gets tomorrow's before it starts.
 */

/** YYYY-MM-DD in `timezone`, for the given instant (default: now). */
export function localDateIn(timezone: string, at: Date = new Date()): string {
  // 'en-CA' formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Local wall-clock hour (0-23) in `timezone`, for the given instant. */
export function localHourIn(timezone: string, at: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(at)
  // en-GB renders midnight as "24" in some ICU versions.
  return Number(hour) % 24
}

/** True if `timezone` is a timezone this runtime actually knows. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/** Split a YYYY-MM-DD string into its parts. Throws on a malformed date. */
export function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new RangeError(`Invalid local date: ${date}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}
