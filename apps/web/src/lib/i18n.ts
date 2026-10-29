/**
 * Minimal gettext-style i18n: the source string (Simplified Chinese) is the message id.
 * Catalogs for other locales map source strings to translations; missing entries fall back
 * to the source. The English catalog is i18n.en.ts.
 */
import { useApp } from '../store/app';
import { EN } from './i18n.en';

export type Locale = 'zh-CN' | 'en';

const catalogs: Record<Locale, Record<string, string>> = {
  'zh-CN': {},
  en: EN,
};

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Server text that carries a name or a number (no catalog key of its own): a few known shapes,
 * and labels joined with " · " part by part.
 */
const PATTERNS: Record<Locale, Array<[RegExp, string]>> = {
  'zh-CN': [],
  en: [
    [/^读取 (\d+) 个文件$/, 'Read $1 files'],
    [/^搜索 (\d+) 次$/, '$1 searches'],
    [/^新建 (\d+) 项$/, '$1 created'],
    [/^更新 (\d+) 次$/, '$1 updates'],
    [/^规则 (.+)$/, 'Rule $1'],
    [/^正在使用 (.+)$/, 'Using $1'],
  ],
};
function fromPatterns(locale: Locale, s: string): string | undefined {
  for (const [re, out] of PATTERNS[locale]) if (re.test(s)) return s.replace(re, out);
  if (s.includes(' · ')) {
    const parts = s.split(' · ').map((p) => catalogs[locale][p] ?? fromPatterns(locale, p));
    if (parts.every((p) => p !== undefined)) return parts.join(' · ');
  }
  return undefined;
}

export function translate(locale: Locale, s: string, vars?: Record<string, string | number>): string {
  const hit = catalogs[locale][s] ?? (locale === 'zh-CN' ? undefined : fromPatterns(locale, s));
  return interpolate(hit ?? s, vars);
}

/** Resolve the effective UI locale from preferences and the browser. */
export function resolveLocale(pref: 'auto' | Locale): Locale {
  if (pref !== 'auto') return pref;
  return /^zh/i.test(navigator.language) ? 'zh-CN' : 'en';
}

/** Translate outside React (e.g. in the mock server). */
export function t(s: string, vars?: Record<string, string | number>): string {
  return translate(resolveLocale(useApp.getState().prefs.uiLanguage), s, vars);
}

/** Hook form so components re-render when the language changes. */
export function useT() {
  const pref = useApp((st) => st.prefs.uiLanguage);
  const locale = resolveLocale(pref);
  return (s: string, vars?: Record<string, string | number>) => translate(locale, s, vars);
}
