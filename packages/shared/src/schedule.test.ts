import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterLimit, describeSchedule, fillVars, isWakeTurn, nextRun, parseCron, promptVars, wakeTooLate } from './schedule';
import type { JobSchedule } from './types';

const base: JobSchedule = { kind: 'daily', time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: true, vars: {}, missed: 'skip' };
const at = (s: string) => new Date(s);
const fmt = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null);

test('daily: later today, or tomorrow once the time has passed', () => {
  assert.equal(fmt(nextRun(base, at('2026-10-30T08:00'))), '2026-10-30 09:00');
  assert.equal(fmt(nextRun(base, at('2026-10-30T09:00'))), '2026-10-31 09:00');
});

test('weekly: the next chosen weekday (Monday = 1, Sunday = 7); none chosen never runs', () => {
  // 2026-10-30 is a Friday.
  assert.equal(fmt(nextRun({ ...base, kind: 'weekly', weekdays: [1] }, at('2026-10-30T10:00'))), '2026-11-02 09:00');
  assert.equal(fmt(nextRun({ ...base, kind: 'weekly', weekdays: [5] }, at('2026-10-30T08:00'))), '2026-10-30 09:00');
  assert.equal(fmt(nextRun({ ...base, kind: 'weekly', weekdays: [7] }, at('2026-10-30T10:00'))), '2026-11-01 09:00');
  assert.equal(nextRun({ ...base, kind: 'weekly', weekdays: [] }, at('2026-10-30T10:00')), null);
});

test('every N hours: the next whole hour that is a multiple of N, across midnight', () => {
  assert.equal(fmt(nextRun({ ...base, kind: 'hourly', everyHours: 6 }, at('2026-10-30T13:20'))), '2026-10-30 18:00');
  assert.equal(fmt(nextRun({ ...base, kind: 'hourly', everyHours: 6 }, at('2026-10-30T22:10'))), '2026-10-31 00:00');
});

test('cron: lists, ranges, steps, day of week 0 and 7 both Sunday, month and year ends', () => {
  const c = (cron: string, from: string) => fmt(nextRun({ ...base, kind: 'cron', cron }, at(from)));
  assert.equal(c('*/15 * * * *', '2026-10-30T10:07'), '2026-10-30 10:15');
  assert.equal(c('0 9-17/4 * * *', '2026-10-30T10:00'), '2026-10-30 13:00');
  assert.equal(c('30 8 * * 1,3', '2026-10-30T10:00'), '2026-11-02 08:30');
  assert.equal(c('0 0 * * 0', '2026-10-30T10:00'), c('0 0 * * 7', '2026-10-30T10:00'));
  assert.equal(c('0 0 1 * *', '2026-12-15T00:00'), '2027-01-01 00:00');
  assert.equal(c('0 12 31 12 *', '2026-10-30T00:00'), '2026-12-31 12:00');
  // Searched a year ahead: a leap day farther away is not found.
  assert.equal(c('0 12 29 2 *', '2026-10-30T00:00'), null);
  assert.equal(parseCron('61 * * * *'), null);
  assert.equal(parseCron('* * *'), null);
  assert.equal(nextRun({ ...base, kind: 'cron', cron: 'nonsense' }, at('2026-10-30T10:00')), null);
});

test('manual and paused jobs never run on their own', () => {
  assert.equal(nextRun({ ...base, kind: 'manual' }, at('2026-10-30T08:00')), null);
});

test('descriptions name the schedule and say when it is paused', () => {
  assert.equal(describeSchedule({ ...base, kind: 'manual' }), '手动运行');
  assert.equal(describeSchedule(base), '每天 09:00');
  assert.equal(describeSchedule({ ...base, kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }), '每个工作日 09:00');
  assert.equal(describeSchedule({ ...base, kind: 'weekly', weekdays: [3, 1] }), '每周一、周三 09:00');
  assert.equal(describeSchedule({ ...base, kind: 'hourly', everyHours: 4, enabled: false }), '每 4 小时（已暂停）');
});

test('prompt variables: in order of first use, without duplicates or the automatic {{date}}; filled, missing ones empty', () => {
  assert.deepEqual(promptVars('从 {{since}} 到 {{until}}，再看 {{since}}，日期 {{date}}'), ['since', 'until']);
  const out = fillVars('从 {{since}} 到 {{until}} · {{date}}', { since: '周一' });
  assert.match(out, /^从 周一 到  · \d{4}-\d{2}-\d{2}$/);
});

test('after a usage limit: a minute past a known reset; half an hour when it is unknown or past; within a minute to six hours', () => {
  const now = Date.UTC(2026, 9, 31, 12, 0);
  const min = 60_000;
  assert.equal(afterLimit(now, now + 90 * min), now + 91 * min);
  assert.equal(afterLimit(now, null), now + 31 * min);
  assert.equal(afterLimit(now, now - 5 * min), now + 31 * min, 'a reset already past');
  assert.equal(afterLimit(now, now + 10_000), now + 70_000, 'at least a minute from now');
  assert.equal(afterLimit(now, now + 9 * 3600_000), now + 6 * 3600_000, 'at most six hours');
});

test('a turn Claude Code starts by itself is the wake-up once its time has come, unless a background task just reported back (issue 10-31#5)', () => {
  const now = Date.UTC(2026, 9, 31, 12, 0);
  assert.equal(isWakeTurn(now - 30_000, [], now), true);
  assert.equal(isWakeTurn(now + 60_000, [], now), false, 'too early: a background task reporting');
  assert.equal(isWakeTurn(now - 30_000, [now - 2000], now), false, 'a task ended just now: its report');
  assert.equal(isWakeTurn(now - 30_000, [now - 60_000, undefined], now), true, 'tasks that ended earlier do not count');
});

test('a wake-up more than a minute overdue is too late (issue 10-31#3)', () => {
  const now = Date.UTC(2026, 9, 31, 12, 0);
  assert.equal(wakeTooLate(now - 5000, now), false, 'on time, give or take a timer');
  assert.equal(wakeTooLate(now - 61_000, now), true);
});
