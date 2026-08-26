import { InlineKeyboard } from 'grammy'

/**
 * Telegram only accepts HTTPS URLs for Mini App buttons — and rejects
 * `localhost` even as a plain link. So in local development we hand the user
 * the address as text instead of a button that the API would refuse to send.
 */
export function canOpenAsMiniApp(url: string): boolean {
  return url.startsWith('https://')
}

export function setupKeyboard(setupUrl: string): InlineKeyboard | undefined {
  if (!canOpenAsMiniApp(setupUrl)) return undefined
  return new InlineKeyboard().webApp('📝 Заполнить данные', setupUrl)
}

export function settingsKeyboard(setupUrl: string): InlineKeyboard | undefined {
  if (!canOpenAsMiniApp(setupUrl)) return undefined
  return new InlineKeyboard().webApp('✏️ Изменить мои данные', setupUrl)
}

export function todayKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🔮 Прогноз на сегодня', 'today')
}

export function feedbackKeyboard(readingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('👍', `fb:${readingId}:1`)
    .text('👎', `fb:${readingId}:-1`)
}

/** Replaces the buttons once a rating is in, so it reads as recorded. */
export function ratedKeyboard(rating: 1 | -1): InlineKeyboard {
  return new InlineKeyboard().text(rating === 1 ? '👍 Спасибо!' : '👎 Учтём', 'rated')
}
