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
 * Server text carrying names and numbers: the server writes it from templates, and the catalog
 * has each template as a key with {placeholders} (scripts/i18n-missing.mjs lists them). Every
 * such key matches as a pattern, the most specific first; what fills a placeholder is translated
 * on its own when the catalog knows it, and kept as it is (a file name, a title) when not.
 */
type Pattern = { re: RegExp; names: string[]; out: string; words: boolean };
const patternCache = new Map<Locale, Pattern[]>();
const CJK = /[㐀-鿿＀-￯　-〿]/;
const WORDS = /[㐀-鿿]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patterns(locale: Locale): Pattern[] {
  let list = patternCache.get(locale);
  if (list) return list;
  list = [];
  const ranked: Array<[number, Pattern]> = [];
  for (const [key, out] of Object.entries(catalogs[locale])) {
    if (!key.includes('{')) continue;
    const pieces = key.split(/\{(\w+)\}/);
    const literal = pieces.filter((_, i) => i % 2 === 0).join('');
    if (pieces.length < 3 || !CJK.test(literal)) continue;
    const names: string[] = [];
    const re = pieces.map((p, i) => (i % 2 ? (names.push(p), '([\\s\\S]*?)') : escape(p))).join('');
    ranked.push([literal.length, { re: new RegExp(`^${re}$`), names, out, words: WORDS.test(literal) }]);
  }
  list = ranked.sort((a, b) => b[0] - a[0]).map(([, p]) => p);
  patternCache.set(locale, list);
  return list;
}

const matched = new Map<string, string | null>();

/**
 * A key whose fixed text is only punctuation ("（{0}）", "{0}：{1}") matches only inside another
 * match: on its own it would rewrite any text that happens to hold a full-width colon.
 */
function fromPatterns(locale: Locale, s: string, inner = false): string | undefined {
  if (!CJK.test(s)) return undefined;
  const memo = `${locale}${inner ? '+' : ''}\u0000${s}`;
  const seen = matched.get(memo);
  if (seen !== undefined) return seen ?? undefined;
  let hit: string | undefined;
  for (const p of patterns(locale)) {
    if (!p.words && !inner) continue;
    const m = p.re.exec(s);
    if (!m) continue;
    const vars: Record<string, string> = {};
    p.names.forEach((n, i) => (vars[n] = m[i + 1] && (catalogs[locale][m[i + 1]] ?? fromPatterns(locale, m[i + 1], true) ?? m[i + 1])));
    hit = interpolate(p.out, vars);
    break;
  }
  // Labels joined with " · ", part by part.
  if (hit === undefined && s.includes(' · ')) {
    const parts = s.split(' · ').map((x) => catalogs[locale][x] ?? fromPatterns(locale, x));
    if (parts.every((x) => x !== undefined)) hit = parts.join(' · ');
  }
  if (matched.size > 5000) matched.clear();
  matched.set(memo, hit ?? null);
  return hit;
}

export function translate(locale: Locale, s: string, vars?: Record<string, string | number>): string {
  const hit = catalogs[locale][s] ?? (locale === 'zh-CN' || typeof s !== 'string' ? undefined : fromPatterns(locale, s));
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
