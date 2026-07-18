import { describe, expect, it } from 'vitest'
import {
  createTranslator,
  dictionaries,
  messageKeys,
  resolveLanguage,
  supportedLanguages,
  translate,
} from '../utils/i18n'

describe('i18n dictionaries', () => {
  it('defines every English key in every supported language', () => {
    for (const language of supportedLanguages) {
      const missing = messageKeys.filter((key) => !(key in dictionaries[language]))
      expect(missing, `${language} is missing keys`).toEqual([])
    }
  })

  it('does not carry keys a locale defines that English does not', () => {
    const englishKeys = new Set(messageKeys)
    for (const language of supportedLanguages) {
      const extra = Object.keys(dictionaries[language]).filter((key) => !englishKeys.has(key))
      expect(extra, `${language} has stray keys`).toEqual([])
    }
  })

  it('translates known keys and falls back to English then to the key', () => {
    expect(translate('zh-CN', 'nav.flights')).toBe('航班')
    expect(translate('ja', 'nav.settings')).toBe('設定')
    expect(translate('zh-TW', 'nav.settings')).toBe('設定')
    // Unknown key falls back to the provided fallback, then to the key itself.
    expect(translate('ja', 'unknown.key', 'Fallback')).toBe('Fallback')
    expect(translate('ja', 'unknown.key')).toBe('unknown.key')
  })

  it('uses Traditional-specific vocabulary for zh-TW', () => {
    expect(translate('zh-TW', 'nav.add')).toBe('新增')
    expect(translate('zh-CN', 'nav.add')).toBe('添加')
    expect(translate('zh-TW', 'nav.settings')).not.toBe(translate('zh-CN', 'nav.settings'))
  })
})

describe('language resolution', () => {
  it('returns an explicit setting unchanged', () => {
    expect(resolveLanguage('ja')).toBe('ja')
    expect(resolveLanguage('zh-TW')).toBe('zh-TW')
  })

  it('detects the system language from navigator, distinguishing Traditional Chinese', () => {
    expect(resolveLanguage('system', 'zh-CN')).toBe('zh-CN')
    expect(resolveLanguage('system', 'zh')).toBe('zh-CN')
    expect(resolveLanguage('system', 'zh-TW')).toBe('zh-TW')
    expect(resolveLanguage('system', 'zh-Hant-HK')).toBe('zh-TW')
    expect(resolveLanguage('system', 'zh-HK')).toBe('zh-TW')
    // An explicit Simplified script subtag outranks a Traditional-leaning region.
    expect(resolveLanguage('system', 'zh-Hans-HK')).toBe('zh-CN')
    expect(resolveLanguage('system', 'ja-JP')).toBe('ja')
    expect(resolveLanguage('system', 'fr-FR')).toBe('en')
    expect(resolveLanguage('system', undefined)).toBe('en')
  })

  it('provides a translator bound to a language', () => {
    const t = createTranslator('zh-CN')
    expect(t('nav.trips')).toBe('行程')
    expect(t('missing', 'default')).toBe('default')
  })
})
