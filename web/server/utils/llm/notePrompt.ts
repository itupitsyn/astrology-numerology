/**
 * The script for a video note: Mika retells the day's reading out loud.
 *
 * Input is the finished prose, not the raw facts — it already chose what
 * matters, and retelling is a much easier job for the model than narrating
 * eighty aspects again. The output is speech, so the rules are about the ear:
 * a minute at most (Telegram's limit for a video note), times and numbers as
 * words (the voice reads digits as cardinals — "31 октября" would come out as
 * "тридцать один октября"), and gesture tags the avatar knows how to play.
 */

import type { ChatMessage } from './client'

/** Bump with any meaningful change to the prompt; stored next to the script. */
export const NOTE_PROMPT_VERSION = 'note-v1'

/**
 * Gestures the avatar plays well in a video note. Anything else the model
 * invents is dropped by `cleanNoteScript` — an unknown tag would be read
 * aloud as nothing and played as nothing, but there is no reason to keep it.
 */
export const NOTE_GESTURES = [
  'greet', 'explain', 'think', 'nod', 'surprised', 'shrug', 'happy', 'tilt', 'wink', 'wave',
] as const

/** Speech runs about 18 characters a second, and past 60 s Telegram no longer treats it as a note. */
export const MAX_NOTE_CHARS = 1000

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** "2026-10-31" -> "31 октября". */
export function humanDate(localDate: string): string {
  const [, month = 1, day = 1] = localDate.split('-').map(Number)
  return `${day} ${MONTHS[month - 1]}`
}

const SYSTEM = `Ты — Мика, милая аниме-девушка, ведущая астрологического бота. Ты записываешь кружочек в телеграм: короткое видео, где говоришь прямо в камеру. Перескажи прогноз на день живой разговорной речью.

Правила:
- 35–45 секунд речи: 70–100 слов, шесть–девять коротких предложений.
- Обращайся на «ты», тепло и по-дружески. Без канцелярита и без пугающих формулировок.
- Только главное: общий тон дня, что лучше отложить, когда хорошее время и практический совет. Не перечисляй все аспекты, дома и оценки.
- Время называй словами и по-человечески: «утром», «до обеда», «после двух часов дня». Никаких «14:20».
- Все числа пиши словами: «тридцать первое октября», «личный день тройки».
- Без эмодзи, списков, заголовков и разметки.
- О себе — в женском роде.
- Начни с метки [greet] и приветствия вроде «Привет! Это Мика, и вот твой день…», назови дату. Последнюю фразу — пожелание — начни с метки [wink] или [wave].
- Перед некоторыми предложениями ставь метку жеста в квадратных скобках — не больше одной на предложение и не на каждом: [explain] объясняет, [think] задумалась, [nod] кивает, [surprised] удивилась хорошему, [shrug] «ну что поделать», [happy] радуется, [tilt] наклонила голову.

Ответь только текстом, который Мика произнесёт, с метками.`

export function buildNotePrompt(input: {
  prose: string
  localDate: string
  name?: string | null
}): ChatMessage[] {
  const who = input.name ? `\nИмя: ${input.name} — можно один раз обратиться по имени.` : ''
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Дата: ${humanDate(input.localDate)}.${who}\n\nПрогноз:\n${input.prose}`,
    },
  ]
}

const KNOWN = new Set<string>(NOTE_GESTURES)

/**
 * Make the model's answer safe to hand to the voice: known gesture tags only,
 * no markup or emoji, one line, a greeting at the start, and short enough for
 * a minute — cut at a sentence end rather than mid-word.
 */
export function cleanNoteScript(raw: string): string {
  let text = raw
    .replace(/\[([^\]]*)\]/g, (_, tag: string) => {
      const name = tag.trim().toLowerCase()
      return KNOWN.has(name) ? ` [${name}] ` : ' '
    })
    .replace(/[*_#`>~|]/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?…:;])/g, '$1')
    .trim()

  if (!text.startsWith('[greet]')) text = `[greet] ${text}`

  if (text.length > MAX_NOTE_CHARS) {
    const cut = text.slice(0, MAX_NOTE_CHARS)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    text = (end > 0 ? cut.slice(0, end + 1) : cut).trim()
  }
  return text
}
