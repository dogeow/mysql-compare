import { create } from 'zustand'
import { en, type Dictionary } from './locales/en'
import { zhCN } from './locales/zh-CN'
import { DEFAULT_LOCALE, LOCALES, STORAGE_KEY, type Locale } from './types'

type DictMap = Record<Locale, Dictionary>

const dictionaries: DictMap = {
  en,
  'zh-CN': zhCN,
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && (stored === 'en' || stored === 'zh-CN')) {
      return stored
    }
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
      return 'zh-CN'
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE
}

function writeStoredLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

function resolvePath(dict: Dictionary, key: string): string | undefined {
  const segments = key.split('.')
  let current: unknown = dict
  for (const seg of segments) {
    if (current && typeof current === 'object' && seg in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return typeof current === 'string' ? current : undefined
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const value = vars[name]
    return value === undefined || value === null ? `{{${name}}}` : String(value)
  })
}

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: readStoredLocale(),
  setLocale: (locale) => {
    writeStoredLocale(locale)
    set({ locale })
  },
}))

export type Translator = (key: string, vars?: Record<string, string | number>) => string

export function useTranslator(): Translator {
  const locale = useI18nStore((s) => s.locale)
  const dict = dictionaries[locale] ?? en
  return (key, vars) => {
    const raw = resolvePath(dict, key) ?? resolvePath(en, key) ?? key
    return interpolate(raw, vars)
  }
}

export function useI18n(): {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
} {
  const locale = useI18nStore((s) => s.locale)
  const setLocale = useI18nStore((s) => s.setLocale)
  const t = useTranslator()
  return { locale, setLocale, t }
}

export { LOCALES, DEFAULT_LOCALE, type Locale }
