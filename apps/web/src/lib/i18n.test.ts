import { test } from 'node:test';
import assert from 'node:assert/strict';

// The store reads saved preferences when it loads.
const memory = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) } });
const { translate } = await import('./i18n');

const en = (s: string) => translate('en', s);

test('server text built from a template translates with what fills it', () => {
  assert.equal(en('读取 3 个文件'), 'Read 3 files');
  assert.equal(en('已换到 Opus 4.7（复杂工作和日常任务），Claude Code 重新启动后接着这段对话。'), 'Switched to Opus 4.7 (Complex work and everyday tasks); Claude Code restarts and continues this conversation.');
  assert.equal(en('会话的工作目录不存在：D:\\work\\x'), "The session's working directory does not exist: D:\\work\\x");
});

test('what fills a placeholder is translated on its own when the catalog knows it', () => {
  assert.equal(en('代码审核结束：你停止了审核。'), 'Code review ended: you stopped the review.');
  assert.equal(en('你接受了现状，F1、F2 没有解决'), 'you accepted it as it is; F1、F2 unresolved');
  assert.equal(en('对话已压缩 · 自动 · 压缩前 120k · 压缩后 30k'), 'Conversation compacted · Auto · 120k before · 30k after');
});

test('a key of punctuation only matches inside another match, not on its own', () => {
  assert.equal(en('修复：登录页'), '修复：登录页');
  assert.equal(en('被钩子拒绝：没有权限'), 'Denied by a hook: 没有权限');
});

test('labels joined with " · " translate part by part', () => {
  assert.equal(en('后台运行 · 已拒绝'), 'Run in background · Denied');
});

test('Chinese stays as it is', () => {
  assert.equal(translate('zh-CN', '读取 3 个文件'), '读取 3 个文件');
  assert.equal(en('一段没有翻译的文字'), '一段没有翻译的文字');
});
