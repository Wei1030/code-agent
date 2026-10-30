import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, condFieldsFor, hookOutput, ruleMatches } from './hooks';
import type { HookRule } from './types';

const rule = (p: Partial<HookRule>): HookRule => ({ id: 'r', name: 'r', event: 'PreToolUse', matcher: '', action: 'deny', text: '', timeout: 10, async: false, enabled: true, scope: 'global', ...p });
const edit = (file: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } });

test('matchers: exact name, alternatives, a regex, anything; off never matches', () => {
  assert.ok(ruleMatches(rule({ matcher: 'Edit' }), edit('a')));
  assert.ok(ruleMatches(rule({ matcher: 'Edit|Write' }), edit('a')));
  assert.ok(ruleMatches(rule({ matcher: 'mcp__.*' }), { tool_name: 'mcp__gh__issue' }));
  assert.ok(!ruleMatches(rule({ matcher: 'Bash' }), edit('a')));
  assert.ok(ruleMatches(rule({ matcher: '' }), edit('a')));
  assert.ok(!ruleMatches(rule({ matcher: '(' }), edit('a')), 'a broken regex matches nothing');
  assert.ok(!ruleMatches(rule({ enabled: false }), edit('a')));
});

test('conditions: glob over Windows and POSIX paths and the file name, contains, equals, regex', () => {
  const g = rule({ cond: { field: 'tool_input.file_path', op: 'glob', value: '**/migrations/**' } });
  assert.ok(ruleMatches(g, edit('C:\\repo\\migrations\\001.sql')));
  assert.ok(ruleMatches(g, edit('/repo/migrations/001.sql')));
  assert.ok(!ruleMatches(g, edit('/repo/src/a.ts')));
  assert.ok(ruleMatches(rule({ cond: { field: 'tool_input.file_path', op: 'glob', value: '*.env' } }), edit('C:\\repo\\.env')), 'by file name');
  assert.ok(ruleMatches(rule({ cond: { field: 'tool_input.file_path', op: 'contains', value: 'secret' } }), edit('/a/secret.txt')));
  assert.ok(ruleMatches(rule({ cond: { field: 'tool_name', op: 'eq', value: 'Edit' } }), edit('a')));
  assert.ok(!ruleMatches(rule({ cond: { field: 'tool_input.file_path', op: 'regex', value: '[' } }), edit('a')), 'a broken regex matches nothing');
  assert.ok(ruleMatches(rule({ cond: { field: 'tool_input.file_path', op: 'eq', value: '' } }), edit('a')), 'an empty value is no condition');
});

test('outputs: decisions, rewritten input, added context, title, block', () => {
  assert.deepEqual(hookOutput(rule({ action: 'deny', text: '不行' })), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '不行' } });
  const rw = hookOutput(rule({ action: 'rewrite', text: '{"command":"ls"}' })) as { hookSpecificOutput: { permissionDecision: string; updatedInput: unknown } };
  assert.equal(rw.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(rw.hookSpecificOutput.updatedInput, { command: 'ls' });
  assert.equal((hookOutput(rule({ event: 'UserPromptSubmit', action: 'context', text: '上下文' })) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext, '上下文');
  assert.equal((hookOutput(rule({ event: 'Stop', action: 'block', text: '继续' })) as { decision: string }).decision, 'block');
});

test('what each event offers: actions and condition fields', () => {
  assert.ok(actionsFor('PreToolUse').includes('deny'));
  assert.ok(!actionsFor('SessionEnd').includes('deny'), 'events without decisions only log, notify or call a webhook');
  assert.deepEqual(condFieldsFor('UserPromptSubmit'), ['prompt']);
  assert.ok(condFieldsFor('PostToolUse').includes('tool_input.command'));
});
