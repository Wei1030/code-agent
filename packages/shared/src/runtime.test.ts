import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRuntime, reduce } from './runtime';
import type { Item, SessionRuntime } from './types';

const text = (id: string, t: string): Item => ({ kind: 'text', id, text: t });
const tool = (id: string): Extract<Item, { kind: 'tool' }> => ({ kind: 'tool', id, tool: 'Read', detail: '', status: 'running' });
const run = (rt: SessionRuntime, ...evs: Parameters<typeof reduce>[1][]) => evs.reduce((r, e) => reduce(r, e), rt);

test('items: added at the end or after one, patched, appended to, removed, replaced', () => {
  let rt = run(emptyRuntime('s'), { t: 'item.add', item: text('a', 'A') }, { t: 'item.add', item: text('c', 'C') }, { t: 'item.add', item: text('b', 'B'), after: 'a' });
  assert.deepEqual(rt.items.map((i) => i.id), ['a', 'b', 'c']);
  rt = run(rt, { t: 'item.append', id: 'a', text: '+' }, { t: 'item.patch', id: 'c', patch: { text: 'C2' } }, { t: 'item.remove', id: 'b' });
  assert.deepEqual(rt.items.map((i) => (i as { text: string }).text), ['A+', 'C2']);
  rt = run(rt, { t: 'item.add', item: text('x', 'X'), after: 'missing' });
  assert.equal(rt.items.at(-1)!.id, 'x', 'after an unknown id: at the end');
  rt = { ...rt, earlier: { items: 3, users: [] } };
  rt = run(rt, { t: 'items.reset', items: [text('r', 'R')] });
  assert.deepEqual(rt.items.map((i) => i.id), ['r']);
  assert.equal(rt.earlier, undefined, 'a reset forgets the earlier pages');
});

test('a patch reaches a tool inside a group', () => {
  const rt = run(emptyRuntime('s'), { t: 'item.add', item: { kind: 'toolgroup', id: 'g', label: '读取', tools: [tool('t1')] } }, { t: 'item.patch', id: 't1', patch: { status: 'ok' } });
  assert.equal((rt.items[0] as Extract<Item, { kind: 'toolgroup' }>).tools[0].status, 'ok');
});

test('state, request, queue, settings; raw events and stderr are capped', () => {
  let rt = run(emptyRuntime('s'), { t: 'state', state: 'running' }, { t: 'settings', patch: { mode: 'plan', turn: 2 } }, { t: 'queue', queue: [{ id: 'q', text: '下一条', priority: 'later' }] });
  assert.equal(rt.state, 'running');
  assert.equal(rt.mode, 'plan');
  assert.equal(rt.turn, 2);
  assert.equal(rt.queue.length, 1);
  for (let i = 0; i < 2100; i++) rt = reduce(rt, { t: 'stderr', line: `l${i}` });
  assert.equal(rt.stderr.length, 2000);
  assert.equal(rt.stderr.at(-1), 'l2099');
});
