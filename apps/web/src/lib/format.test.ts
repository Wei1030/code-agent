// Localized formats: relative times, durations, token counts in either number style (FR-I18N-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The store reads saved preferences when it loads.
const memory = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) } });
const { useApp } = await import('../store/app');
const { relTime, duration, tokens, dateTime } = await import('./format');

const prefs = (p: Partial<ReturnType<typeof useApp.getState>['prefs']>) => useApp.setState({ prefs: { ...useApp.getState().prefs, ...p } });
const now = new Date('2026-10-30T12:00:00').getTime();

test('relative times in Chinese and in English', () => {
  prefs({ uiLanguage: 'zh-CN' });
  assert.equal(relTime(now - 10_000, now), '刚刚');
  assert.equal(relTime(now - 5 * 60_000, now), '5 分钟前');
  assert.equal(relTime(now - 3 * 3600_000, now), '3 小时前');
  assert.equal(relTime(now - 30 * 3600_000, now), '昨天');
  assert.equal(relTime(new Date('2026-09-01T10:00').getTime(), now), '9月1日');
  prefs({ uiLanguage: 'en' });
  assert.equal(relTime(now - 5 * 60_000, now), '5 min ago');
  assert.equal(relTime(new Date('2026-09-01T10:00').getTime(), now), 'Sep 1');
  assert.equal(dateTime(new Date('2026-09-01T08:05').getTime()), 'Sep 1, 2026 08:05');
});

test('durations', () => {
  prefs({ uiLanguage: 'zh-CN' });
  assert.equal(duration(3.21), '3.2 秒');
  assert.equal(duration(75), '1分15秒');
  prefs({ uiLanguage: 'en' });
  assert.equal(duration(75), '1m 15s');
});

test('token counts in the international and the Chinese number style', () => {
  prefs({ numberStyle: 'intl' });
  assert.equal(tokens(950), '950');
  assert.equal(tokens(1234), '1.2k');
  assert.equal(tokens(18_400_000), '18.4M');
  prefs({ numberStyle: 'cn' });
  assert.equal(tokens(18_400_000), '1840万');
  assert.equal(tokens(250_000_000), '2.5亿');
});
