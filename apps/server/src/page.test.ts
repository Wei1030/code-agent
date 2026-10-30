import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Item, SessionRuntime } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';
import { lastPage, pageBefore, pageStart } from './sessions/page';

const user = (id: string): Item => ({ kind: 'user', id, text: `prompt ${id}`, attachments: [], ts: 1 });
const said = (id: string): Item => ({ kind: 'text', id, text: 'ok' });
/** Turns of `len` items each: a prompt and replies. */
const turns = (n: number, len: number): Item[] =>
  Array.from({ length: n }, (_, t) => [user(`u${t}`), ...Array.from({ length: len - 1 }, (_, i) => said(`t${t}.${i}`))]).flat();

test('a page starts at a prompt, going back for one rather than cutting a turn', () => {
  const items = turns(10, 10);
  assert.equal(pageStart(items, 100, 25), 70);
  assert.equal(items[70].kind, 'user');
});

test('a turn longer than half a page more is cut at the next prompt inside the page, or where it falls', () => {
  assert.equal(pageStart([...turns(1, 100), ...turns(1, 10)], 110, 25), 100);
  assert.equal(pageStart(turns(1, 200), 200, 25), 175);
});

test('a short transcript comes whole', () => {
  const r = lastPage({ ...emptyRuntime('s'), items: turns(3, 5) } as SessionRuntime, 25);
  assert.equal(r.items.length, 15);
  assert.equal(r.earlier, undefined);
});

test('the last page says what is before it; the page before an item does too', () => {
  const items = turns(10, 10);
  const r = lastPage({ ...emptyRuntime('s'), items } as SessionRuntime, 25);
  assert.equal(r.items[0].id, 'u7');
  assert.deepEqual(r.earlier?.users.map((u) => u.id), ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
  assert.equal(r.earlier?.items, 70);
  const before = pageBefore(items, 'u7', 25);
  assert.equal(before.items[0].id, 'u4');
  assert.equal(before.items[before.items.length - 1].id, 't6.8');
  assert.equal(before.earlier?.items, 40);
  const first = pageBefore(items, 'u2', 25);
  assert.equal(first.items[0].id, 'u0');
  assert.equal(first.earlier, undefined);
});
