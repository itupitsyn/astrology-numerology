/**
 * Telegram bot: the front door to the daily forecast.
 *
 * It holds no astrology, no database and no user data — it knows a Telegram id
 * and calls `/api/bot/*`. Profiles live behind the web app, which is where the
 * user is sent the first time they ask for anything.
 *
 * Long polling, so it runs anywhere without a public address. Switching to a
 * webhook later is a change to this file only.
 */

import { Bot, GrammyError, HttpError } from 'grammy'
import { fetchProfileStatus, sendFeedback } from './api'
import { config } from './config'
import { promptForProfile, sendDaily } from './daily'
import { forgetInlineCache, handleInlineQuery } from './inline'
import { ratedKeyboard, settingsKeyboard, todayKeyboard } from './keyboards'

const bot = new Bot(config.botToken)

const HELP = [
  'Что я умею:',
  '',
  '/today — прогноз на сегодня',
  '/settings — изменить дату, время и место рождения',
  '/help — эта справка',
  '',
  'Меня можно позвать в любой чат: наберите @имя_бота — и коротким сообщением ' +
    'отправится прогноз на сегодня.',
  '',
  'Прогноз считается на ваши сутки — по тому городу, где вы живёте сейчас.',
].join('\n')

bot.command('start', async (ctx) => {
  const status = await fetchProfileStatus(ctx.from!.id)

  // Arrived from the inline picker's "Заполнить данные" button.
  if (ctx.match === 'setup' && !status.exists) {
    await promptForProfile(ctx, status.setupUrl)
    return
  }

  if (!status.exists) {
    await ctx.reply('Привет! Составлю для вас астрологический прогноз на каждый день.')
    await promptForProfile(ctx, status.setupUrl)
    return
  }

  await ctx.reply(
    status.name
      ? `С возвращением, ${status.name}! Готов составить прогноз на сегодня.`
      : 'С возвращением! Готов составить прогноз на сегодня.',
    { reply_markup: todayKeyboard() },
  )
})

bot.command('help', (ctx) => ctx.reply(HELP))

bot.command('today', sendDaily)

bot.command('settings', async (ctx) => {
  const status = await fetchProfileStatus(ctx.from!.id)

  // They are about to change their data, so the inline memo is on its way out.
  forgetInlineCache(ctx.from!.id)

  if (!status.exists) {
    await promptForProfile(ctx, status.setupUrl)
    return
  }

  const keyboard = settingsKeyboard(status.setupUrl)
  await ctx.reply(
    keyboard
      ? 'Здесь можно поправить дату, время и место рождения, а также город, где вы сейчас живёте.'
      : `Форма ваших данных: ${status.setupUrl}`,
    { reply_markup: keyboard },
  )
})

bot.callbackQuery('today', async (ctx) => {
  await ctx.answerCallbackQuery()
  await sendDaily(ctx)
})

bot.callbackQuery(/^fb:([A-Za-z0-9_-]{1,32}):(-?1)$/, async (ctx) => {
  const readingId = ctx.match![1]!
  const rating = Number(ctx.match![2]) as 1 | -1
  try {
    await sendFeedback(readingId, rating)
    await ctx.answerCallbackQuery({ text: rating === 1 ? 'Спасибо!' : 'Спасибо, учтём.' })
    await ctx.editMessageReplyMarkup({ reply_markup: ratedKeyboard(rating) })
  } catch (err) {
    console.error('[feedback] failed', err)
    await ctx.answerCallbackQuery({ text: 'Не получилось записать оценку.' })
  }
})

// A tap on the already-rated button should do nothing, not look broken.
bot.callbackQuery('rated', (ctx) => ctx.answerCallbackQuery())

// Inline mode: `@bot` from any chat. Facts only, deliberately short — see
// src/inline.ts for why the prose can never come along for the ride.
bot.on('inline_query', handleInlineQuery)

bot.catch((err) => {
  const ctx = err.ctx
  console.error(`[bot] error while handling update ${ctx.update.update_id}:`)
  if (err.error instanceof GrammyError) {
    console.error('Telegram API:', err.error.description)
  } else if (err.error instanceof HttpError) {
    console.error('Could not reach Telegram:', err.error)
  } else {
    console.error(err.error)
  }
})

async function main() {
  await bot.api.setMyCommands([
    { command: 'today', description: 'Прогноз на сегодня' },
    { command: 'settings', description: 'Мои данные' },
    { command: 'help', description: 'Справка' },
  ])

  const me = await bot.api.getMe()
  console.log(`[bot] started as @${me.username}, API: ${config.apiBaseUrl}`)

  // Docker sends SIGTERM; finish the in-flight update rather than dropping it.
  const stop = () => {
    console.log('[bot] stopping…')
    void bot.stop()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  await bot.start({ drop_pending_updates: true })
}

main().catch((err) => {
  console.error('[bot] failed to start:', err)
  process.exit(1)
})
