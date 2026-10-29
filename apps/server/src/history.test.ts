import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Item } from '@code-agent/shared/types';

process.env.CODE_AGENT_HOME = mkdtempSync(path.join(os.tmpdir(), 'ca-history-'));
const { unseen } = await import('./sessions/history');

let n = 0;
const msg = (type: SessionMessage['type'], message: unknown, uuid = `m${++n}`): SessionMessage =>
  ({ type, uuid, session_id: 's', message, parent_tool_use_id: null, parent_agent_id: null });
const prompt = (uuid: string, text: string) => msg('user', { role: 'user', content: text }, uuid);
const reply = (text = 'ok') => msg('assistant', { role: 'assistant', content: [{ type: 'text', text }] });
const boundary = () => msg('system', undefined);
const ours = (id: string, text: string): Item => ({ kind: 'user', id, text, attachments: [], ts: 0 });
const said = (text = 'ok'): Item => ({ kind: 'text', id: `t${++n}`, text });
const uuids = (ms: SessionMessage[] | undefined) => ms?.map((m) => m.uuid);

const shown = [ours('u1', '加上校验'), said(), ours('u2', '再补测试'), said()];

test('turns taken in the CLI after the last message Code Agent knows are new', () => {
  const tail = [prompt('u3', 'run the tests'), reply()];
  const part = unseen(shown, [prompt('u1', '加上校验'), reply(), prompt('u2', '再补测试'), reply(), ...tail]);
  assert.equal(part?.label, '以下是在 Claude Code 里继续的内容');
  assert.deepEqual(uuids(part?.msgs), uuids(tail));
});

test('nothing new when the CLI added no prompt, even if the last turn went on there', () => {
  assert.equal(unseen(shown, [prompt('u1', '加上校验'), reply(), prompt('u2', '再补测试'), reply(), reply('more')]), undefined);
});

test('going back to an earlier message in the CLI is named', () => {
  const tail = [prompt('u3', 'try another way'), reply()];
  const part = unseen(shown, [prompt('u1', '加上校验'), reply(), ...tail]);
  assert.equal(part?.label, '在 Claude Code 里回退到「加上校验」之后继续');
  assert.deepEqual(uuids(part?.msgs), uuids(tail));
});

test('a command Code Agent sent is not taken for going back', () => {
  const part = unseen([...shown, ours('c1', '/compact')], [prompt('u1', '加上校验'), reply(), prompt('u2', '再补测试'), reply(), prompt('u3', 'next'), reply()]);
  assert.equal(part?.label, '以下是在 Claude Code 里继续的内容');
});

test('after a compaction in the CLI, what follows the summary from the next prompt is new', () => {
  const after = [prompt('u4', 'go on'), reply()];
  const summary = prompt('s1', 'This session is being continued from a previous conversation that ran out of context. …');
  // The last reply from before the compaction, kept after the summary.
  const part = unseen(shown, [boundary(), summary, reply('kept'), ...after]);
  assert.equal(part?.label, '以下是在 Claude Code 里继续的内容；对话在那里压缩过，压缩前的部分只剩摘要');
  assert.deepEqual(uuids(part?.msgs), uuids(after));
});

test('context Code Agent added without showing it is not new', () => {
  const chain = [prompt('u1', '加上校验'), reply(), prompt('u2', '再补测试'), reply(), prompt('x1', '[Code Agent] The user did not let your message through.')];
  assert.equal(unseen(shown, chain), undefined);
  const tail = [prompt('u3', 'continue'), reply()];
  assert.deepEqual(uuids(unseen(shown, [...chain, ...tail])?.msgs), uuids(tail));
});

test('a tool call, or a reply read from the transcript before, is a place the two are in step too', () => {
  const tail = [prompt('u5', 'and then'), reply()];
  const call = msg('assistant', { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] });
  const ran: Item[] = [ours('u1', '加上校验'), { kind: 'toolgroup', id: 'g1', label: '读取 1 个文件', tools: [{ kind: 'tool', id: 'toolu_1', tool: 'Read', detail: 'a.js', status: 'ok' }] }, said()];
  assert.deepEqual(uuids(unseen(ran, [call, reply(), ...tail])?.msgs), uuids(tail));
  const read = reply('read before');
  const summary = prompt('s1', 'This session is being continued from a previous conversation that ran out of context. …');
  const part = unseen([...shown, { kind: 'text', id: `${read.uuid}:0`, text: 'read before' }], [summary, read, ...tail]);
  assert.equal(part?.label, '以下是在 Claude Code 里继续的内容');
  assert.deepEqual(uuids(part?.msgs), uuids(tail));
});

test('a transcript with nothing in common and no compaction is left alone', () => {
  assert.equal(unseen(shown, [prompt('z1', 'other'), reply()]), undefined);
});
