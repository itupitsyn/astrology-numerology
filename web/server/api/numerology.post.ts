import { computeNumerology } from '../utils/numerology/core'
import type { NumerologyInput } from '../utils/numerology/types'

/**
 * POST /api/numerology
 *
 * Body: { birth: { year, month, day }, fullName?, targetYear? }
 * Returns the full NumerologyResult. The algorithm lives in server/utils and is
 * never shipped to the client.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<NumerologyInput>>(event)

  const birth = body?.birth
  if (
    !birth ||
    typeof birth.year !== 'number' ||
    typeof birth.month !== 'number' ||
    typeof birth.day !== 'number'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'birth.{year,month,day} are required numbers',
    })
  }

  try {
    return computeNumerology({
      birth,
      fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
      targetYear: typeof body.targetYear === 'number' ? body.targetYear : undefined,
    })
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : 'Invalid input',
    })
  }
})
