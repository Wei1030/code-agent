// The transcript index behind the History page's search and the search_history tool
// (issues 10-30#18, 10-30#21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Item, ToolItem } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';

process.env.CODE_AGENT_HOME = mkdtempSync(path.join(os.tmpdir(), 'ca-search-'));
const { initRuntime, searchTranscripts, upsert } = await import('./sessions/registry');
const { flush } = await import('./store');

function session(id: string, items: Item[]) {
  const now = Date.now();
  upsert({ id, workspaceId: 'w', title: id, firstPrompt: '', branch: null, createdAt: now, lastActive: now, tag: null, live: false, state: 'idle', forkedFrom: null, tokens: 0 });
  initRuntime(emptyRuntime(id, { items }));
  flush();
}
const said = (id: string, text: string): Item => ({ kind: 'text', id, text });
const read = (id: string, detail: string): ToolItem => ({ kind: 'tool', id, tool: 'Read', detail, status: 'ok' });
const items = (hits: Array<{ item: string }>) => hits.map((h) => h.item);

test('the latest matches come first, however many earlier ones there are; sessions in the order asked', () => {
  session('long', Array.from({ length: 500 }, (_, i) => said(`long-${i}`, `common word ${i}`)));
  session('short', [said('short-0', 'common word here')]);
  assert.deepEqual(items(searchTranscripts('common word', 20, ['long'])), Array.from({ length: 20 }, (_, i) => `long-${499 - i}`));
  assert.deepEqual(items(searchTranscripts('common word', 3, ['short', 'long'])), ['short-0', 'long-499', 'long-498']);
  assert.deepEqual(items(searchTranscripts('co', 2, ['long'])), ['long-499', 'long-498'], 'terms under 3 characters too');
});

test('tool calls folded into a group are found, as the group', () => {
  session('grouped', [{ kind: 'toolgroup', id: 'g1', label: '读取 2 个文件', tools: [read('t1', 'src/orders.js'), read('t2', 'README.md')] }]);
  assert.deepEqual(items(searchTranscripts('src/orders.js', 10, ['grouped'])), ['g1']);
});
