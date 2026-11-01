import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './client'
import { MAX_NOTE_CHARS, buildNotePrompt, cleanNoteScript, humanDate } from './notePrompt'

describe('humanDate', () => {
  it('reads like speech', () => {
    expect(humanDate('2026-10-31')).toBe('31 октября')
    expect(humanDate('2026-01-05')).toBe('5 января')
  })
})

describe('buildNotePrompt', () => {
  it('hands over the date, the prose and, if known, the name', () => {
    const [system, user] = buildNotePrompt({ prose: 'Утро колючее.', localDate: '2026-10-31', name: 'Аня' }) as [ChatMessage, ChatMessage]
    expect(system.role).toBe('system')
    expect(user.content).toContain('31 октября')
    expect(user.content).toContain('Утро колючее.')
    expect(user.content).toContain('Аня')
  })

  it('leaves the name out when there is none', () => {
    const [, user] = buildNotePrompt({ prose: 'x', localDate: '2026-10-31' }) as [ChatMessage, ChatMessage]
    expect(user.content).not.toContain('Имя')
  })
})

describe('cleanNoteScript', () => {
  it('keeps known gestures and drops invented ones', () => {
    expect(cleanNoteScript('[greet] Привет! [dance] Танцую. [Wink] Пока!')).toBe('[greet] Привет! Танцую. [wink] Пока!')
  })

  it('strips markdown, emoji and line breaks', () => {
    expect(cleanNoteScript('[greet] **Привет**! 🌙\n\nЭто _Мика_.')).toBe('[greet] Привет! Это Мика.')
  })

  it('puts the greeting first when the model forgot it', () => {
    expect(cleanNoteScript('Привет! Это Мика.')).toBe('[greet] Привет! Это Мика.')
  })

  it('cuts an overlong script at a sentence end', () => {
    const long = '[greet] ' + 'Это очень длинное предложение про звёзды. '.repeat(60)
    const out = cleanNoteScript(long)
    expect(out.length).toBeLessThanOrEqual(MAX_NOTE_CHARS)
    expect(out.endsWith('.')).toBe(true)
  })
})
