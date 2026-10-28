/** Job schedules: plain-language descriptions and the next run time (including 5-field cron). */
import type { JobSchedule } from '../api/types';

const WEEKDAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function describeSchedule(s: JobSchedule): string {
  if (s.kind === 'manual') return '手动运行';
  const off = s.enabled ? '' : '（已暂停）';
  if (s.kind === 'daily') return `每天 ${s.time}${off}`;
  if (s.kind === 'weekly') {
    const days = [...s.weekdays].sort((a, b) => a - b);
    const label = days.length === 5 && days.every((d, i) => d === i + 1) ? '工作日' : days.map((d) => WEEKDAY[d]).join('、');
    return `每${label === '工作日' ? '个工作日' : label} ${s.time}${off}`;
  }
  if (s.kind === 'hourly') return `每 ${s.everyHours} 小时${off}`;
  return `cron ${s.cron}${off}`;
}

function at(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** Parse one cron field into the set of allowed values, or null when invalid. */
function field(expr: string, lo: number, hi: number): number[] | null {
  const out = new Set<number>();
  for (const part of expr.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    let a = lo;
    let b = hi;
    if (m[1] !== '*') {
      const [x, y] = m[1].split('-').map(Number);
      a = x;
      b = y ?? (m[2] ? hi : x);
    }
    if (a < lo || b > hi || a > b || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out].sort((p, q) => p - q);
}

export function parseCron(expr: string) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const min = field(f[0], 0, 59);
  const hour = field(f[1], 0, 23);
  const dom = field(f[2], 1, 31);
  const mon = field(f[3], 1, 12);
  const dow = field(f[4], 0, 7)?.map((d) => (d === 7 ? 0 : d));
  if (!min || !hour || !dom || !mon || !dow) return null;
  return { min, hour, dom, mon, dow, anyDom: f[2] === '*', anyDow: f[4] === '*' };
}

/** The next time the schedule fires after `from`, or null for manual / paused / invalid schedules. */
export function nextRun(s: JobSchedule, from = new Date()): Date | null {
  if (s.kind === 'manual' || !s.enabled) return null;
  if (s.kind === 'hourly') {
    const d = new Date(from);
    d.setMinutes(0, 0, 0);
    do d.setHours(d.getHours() + 1); while (d.getHours() % s.everyHours !== 0);
    return d;
  }
  if (s.kind === 'daily' || s.kind === 'weekly') {
    for (let i = 0; i < 8; i++) {
      const day = new Date(from);
      day.setDate(day.getDate() + i);
      const wd = ((day.getDay() + 6) % 7) + 1;
      if (s.kind === 'weekly' && !s.weekdays.includes(wd)) continue;
      const t = at(day, s.time);
      if (t > from) return t;
    }
    return null;
  }
  const c = parseCron(s.cron);
  if (!c) return null;
  for (let i = 0; i < 366; i++) {
    const day = new Date(from);
    day.setDate(day.getDate() + i);
    if (!c.mon.includes(day.getMonth() + 1)) continue;
    const domOk = c.dom.includes(day.getDate());
    const dowOk = c.dow.includes(day.getDay());
    // Standard cron: when both day fields are restricted, either may match.
    if (!(c.anyDom || c.anyDow ? domOk && dowOk : domOk || dowOk)) continue;
    for (const h of c.hour) {
      for (const m of c.min) {
        const t = new Date(day);
        t.setHours(h, m, 0, 0);
        if (t > from) return t;
      }
    }
  }
  return null;
}

/** `{{name}}` placeholders in a prompt, in order of first use; `date` is filled automatically. */
export function promptVars(prompt: string): string[] {
  const out: string[] = [];
  for (const m of prompt.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)) if (m[1] !== 'date' && !out.includes(m[1])) out.push(m[1]);
  return out;
}

export function fillVars(prompt: string, vars: Record<string, string>): string {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return prompt.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k: string) => (k === 'date' ? date : vars[k] ?? ''));
}
