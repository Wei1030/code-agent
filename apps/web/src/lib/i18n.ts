/**
 * Minimal gettext-style i18n: the source string (Simplified Chinese) is the message id.
 * Catalogs for other locales map source strings to translations; missing entries fall back
 * to the source. Translations are added once the interaction design is final.
 */
import { useApp } from '../store/app';

export type Locale = 'zh-CN' | 'en';

const catalogs: Record<Locale, Record<string, string>> = {
  'zh-CN': {},
  en: {},
};

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(locale: Locale, s: string, vars?: Record<string, string | number>): string {
  return interpolate(catalogs[locale][s] ?? s, vars);
}

/** Resolve the effective UI locale from preferences and the browser. */
export function resolveLocale(pref: 'auto' | Locale): Locale {
  if (pref !== 'auto') return pref;
  // English is not offered yet, so "follow the browser" resolves to Chinese until its catalog exists.
  return 'zh-CN';
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
