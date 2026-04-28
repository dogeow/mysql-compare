export type Locale = 'en' | 'zh-CN'

export interface LocaleOption {
  code: Locale
  label: string
}

export const LOCALES: LocaleOption[] = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
]

export const DEFAULT_LOCALE: Locale = 'en'
export const STORAGE_KEY = 'mysql-compare-locale'
