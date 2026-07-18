import type { LanguageSetting } from '../types'

export type Language = 'en' | 'zh-CN' | 'zh-TW' | 'ja'
export type { LanguageSetting }

export const supportedLanguages: Language[] = ['en', 'zh-CN', 'zh-TW', 'ja']

export const languageOptions: Array<{ value: LanguageSetting; label: string }> = [
  { value: 'system', label: 'System default' },
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
]

// Message keys. English is the source of truth and the fallback for any key a
// locale has not translated yet. Translations are best-effort and pending
// native-speaker review (see docs/ROADMAP.md).
const en: Record<string, string> = {
  'nav.dashboard': 'Dashboard',
  'nav.flights': 'Flights',
  'nav.trips': 'Trips',
  'nav.map': 'Map',
  'nav.passport': 'Passport',
  'nav.backup': 'Backup',
  'nav.sync': 'Sync',
  'nav.settings': 'Settings',
  'nav.trash': 'Trash',
  'nav.account': 'Account',
  'nav.home': 'Home',
  'nav.add': 'Add',
  'nav.more': 'More',
  'action.addFlight': 'Add flight',
  'settings.language': 'Language',
  'settings.languageHelp': 'Translations are best-effort and pending native-speaker review. Untranslated text falls back to English.',
  'footer.tagline': 'personal flight passport',
  'footer.storage': 'data stored locally in your browser',
}

const zhCN: Record<string, string> = {
  'nav.dashboard': '仪表盘',
  'nav.flights': '航班',
  'nav.trips': '行程',
  'nav.map': '地图',
  'nav.passport': '护照',
  'nav.backup': '备份',
  'nav.sync': '同步',
  'nav.settings': '设置',
  'nav.trash': '回收站',
  'nav.account': '账户',
  'nav.home': '主页',
  'nav.add': '添加',
  'nav.more': '更多',
  'action.addFlight': '添加航班',
  'settings.language': '语言',
  'settings.languageHelp': '翻译为尽力而为的版本，尚待母语者校对。未翻译的内容将回退为英文。',
  'footer.tagline': '个人航班护照',
  'footer.storage': '数据保存在你的浏览器本地',
}

const zhTW: Record<string, string> = {
  'nav.dashboard': '儀表板',
  'nav.flights': '航班',
  'nav.trips': '行程',
  'nav.map': '地圖',
  'nav.passport': '護照',
  'nav.backup': '備份',
  'nav.sync': '同步',
  'nav.settings': '設定',
  'nav.trash': '垃圾桶',
  'nav.account': '帳戶',
  'nav.home': '首頁',
  'nav.add': '新增',
  'nav.more': '更多',
  'action.addFlight': '新增航班',
  'settings.language': '語言',
  'settings.languageHelp': '翻譯為盡力而為的版本，尚待母語者校對。未翻譯的內容將回退為英文。',
  'footer.tagline': '個人航班護照',
  'footer.storage': '資料儲存在你的瀏覽器本機',
}

const ja: Record<string, string> = {
  'nav.dashboard': 'ダッシュボード',
  'nav.flights': 'フライト',
  'nav.trips': '旅程',
  'nav.map': 'マップ',
  'nav.passport': 'パスポート',
  'nav.backup': 'バックアップ',
  'nav.sync': '同期',
  'nav.settings': '設定',
  'nav.trash': 'ゴミ箱',
  'nav.account': 'アカウント',
  'nav.home': 'ホーム',
  'nav.add': '追加',
  'nav.more': 'その他',
  'action.addFlight': 'フライトを追加',
  'settings.language': '言語',
  'settings.languageHelp': '翻訳は暫定版で、ネイティブによる確認待ちです。未翻訳の項目は英語で表示されます。',
  'footer.tagline': '個人フライトパスポート',
  'footer.storage': 'データはブラウザー内にローカル保存されます',
}

export const dictionaries: Record<Language, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
}

export const messageKeys: string[] = Object.keys(en)

export function resolveLanguage(setting: LanguageSetting, navigatorLanguage?: string): Language {
  if (setting !== 'system') return setting
  const raw = (navigatorLanguage ?? '').toLowerCase()
  if (raw.startsWith('zh')) {
    // An explicit Simplified script subtag wins over a Traditional-leaning region.
    if (/(?:^|[-_])hans(?:$|[-_])/.test(raw)) return 'zh-CN'
    return /(?:^|[-_])(?:tw|hk|mo|hant)/.test(raw) ? 'zh-TW' : 'zh-CN'
  }
  if (raw.startsWith('ja')) return 'ja'
  return 'en'
}

export function translate(language: Language, key: string, fallback?: string): string {
  return dictionaries[language]?.[key] ?? dictionaries.en[key] ?? fallback ?? key
}

export type Translator = (key: string, fallback?: string) => string

export function createTranslator(language: Language): Translator {
  return (key, fallback) => translate(language, key, fallback)
}
