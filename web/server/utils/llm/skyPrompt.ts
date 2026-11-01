/**
 * The script for the general video note (/sky): Mika tells how the day looks for
 * everybody, with no chart and no person behind it. Unlike a personal note there
 * is no finished prose to retell, so the brief goes straight into speech, by the
 * same rules for the ear as `notePrompt.ts`.
 */

import type { SkyForecast } from '../astro/daily'
import type { ChatMessage } from './client'
import { byTime, eventsBlock, highlightLine, moonBlock, PLANET_RU } from './dailyPrompt'
import { humanDate } from './notePrompt'

/** Stored with each reading, like NOTE_PROMPT_VERSION. */
export const SKY_PROMPT_VERSION = 'sky-note-v1'

const SYSTEM_PROMPT = `Ты — Мика, милая аниме-девушка, ведущая астрологического бота. Ты записываешь кружочек в телеграм: короткое видео, где говоришь прямо в камеру. Расскажи живой разговорной речью, какой сегодня день для всех. Его будут смотреть в групповых чатах.

Правила:
- 35–45 секунд речи: 70–100 слов, шесть–девять коротких предложений.
- Опирайся ТОЛЬКО на приведённые данные. Не выдумывай аспекты, положения планет и события, которых нет в брифе.
- Натальной карты нет. Не упоминай личные карты, дома, Асцендент и знак зрителя. Обращайся ко всем сразу, на «вы»: «ребята», «сегодня у нас».
- Только главное: общий тон дня, что лучше отложить, когда хорошее время и практический совет. Скобка «по карте: …» дана тебе для точности, не пересказывай её и не называй аспекты.
- Говори о склонностях и настрое, а не о происшествиях. Предсказывать конкретные события нельзя. Без пугающих формулировок и без медицинских, юридических и финансовых советов.
- Пометка «фон» — медленный транзит, который держится неделями: максимум одна фраза как общий период.
- Если Луна без курса — обязательно скажи, когда в этот день лучше не начинать новое.
- Всё время в брифе московское. Называй его словами и по-человечески: «утром», «до обеда», «после двух часов дня». Никаких «14:20». Если называешь час, один раз уточни, что по Москве.
- Все числа пиши словами: «первое ноября».
- Без эмодзи, списков, заголовков и разметки. Пиши строго на русском языке.
- О себе — в женском роде.
- Начни с метки [greet] и приветствия вроде «Всем привет! Это Мика, и вот какой у нас сегодня день…», назови дату. Последнюю фразу — пожелание — начни с метки [wink] или [wave].
- Перед некоторыми предложениями ставь метку жеста в квадратных скобках — не больше одной на предложение и не на каждом: [explain] объясняет, [think] задумалась, [nod] кивает, [surprised] удивилась хорошему, [shrug] «ну что поделать», [happy] радуется, [tilt] наклонила голову.

Ответь только текстом, который Мика произнесёт, с метками.`

export function buildSkyPrompt(forecast: SkyForecast): ChatMessage[] {
  const today = forecast.highlights.filter((h) => h.layer === 'today')
  const background = forecast.highlights.filter((h) => h.layer === 'background')

  const parts = [
    `Дата: ${humanDate(forecast.date)}`,
    '',
    moonBlock(forecast),
    '',
    'ГЛАВНОЕ ЗА ДЕНЬ (по времени, от начала суток; пункты без времени — весь день):',
    ...(today.length > 0 ? byTime(today).map(highlightLine) : ['  • день без выраженных событий']),
    background.length > 0
      ? `\nОБЩИЙ ПЕРИОД (фон, держится неделями — только контекст):\n${background.map(highlightLine).join('\n')}`
      : null,
    '',
    eventsBlock(forecast),
    forecast.retrogrades.length > 0
      ? `РЕТРОГРАДНЫЕ ПЛАНЕТЫ: ${forecast.retrogrades.map((p) => PLANET_RU[p] ?? p).join(', ')}`
      : null,
  ].filter((part): part is string => part !== null)

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ]
}
