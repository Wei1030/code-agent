/** Locale-aware formatting helpers (Simplified Chinese or English, by the UI language). */
import { useApp } from '../store/app';
import { resolveLocale } from './i18n';

const en = () => resolveLocale(useApp.getState().prefs.uiLanguage) === 'en';
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relTime(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (en()) {
    if (d < 45_000) return 'just now';
    if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} min ago`;
    if (d < DAY) return `${Math.round(d / HOUR)} h ago`;
    if (d < 2 * DAY) return 'yesterday';
    if (d < 7 * DAY) return EN_DAYS[new Date(ts).getDay()];
    const dt = new Date(ts);
    return `${EN_MONTHS[dt.getMonth()]} ${dt.getDate()}`;
  }
  if (d < 45_000) return '刚刚';
  if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} 分钟前`;
  if (d < DAY) return `${Math.round(d / HOUR)} 小时前`;
  if (d < 2 * DAY) return '昨天';
  if (d < 7 * DAY) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(ts).getDay()];
  const dt = new Date(ts);
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
}

export function dateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  if (en()) return `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function duration(sec: number): string {
  const e = en();
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}${e ? 's' : ' 秒'}`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (e) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${m}分${String(s).padStart(2, '0')}秒`;
}

/** Compact token counts: 1234 → 1.2k, 18_400_000 → 18.4M (or 1840万 with the Chinese number style). */
export function tokens(n: number): string {
  if (useApp.getState().prefs.numberStyle === 'cn') {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2).replace(/\.?0+$/, '')}亿`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1).replace(/\.0$/, '')}万`;
    return String(n);
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function num(n: number): string {
  return n.toLocaleString(en() ? 'en-US' : 'zh-CN');
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}
