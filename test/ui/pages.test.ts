// Every page and the common dialogs open without page errors, in Chinese and in English; in English
// no Chinese is left on screen; every button has a name for screen readers (FR-I18N-01..03, NFR-07,
// NFR-08, issue 10-30#11). The world's own data (workspace, sessions, board items, jobs, hooks) is
// all ASCII, so any Chinese shown is untranslated UI text.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupUi, noPageErrors, type UiEnv } from '../harness/ui';
import { say, use } from '../harness/fake-model';
import type { Page } from '../harness/browser';

let env: UiEnv;
let sid = '';
before(async () => {
  env = await setupUi({ files: { 'a.txt': 'one\n' } });
  env.model.script(/^Add a check$/, [[use('TaskCreate', { subject: 'Check input', description: 'Check input', activeForm: 'Checking input' })], [use('Edit', { file_path: '{cwd}/a.txt', old_string: 'one', new_string: 'two' })], [say('Done: the check is in.')]]);
  sid = await env.start('Add a check', { mode: 'acceptEdits' });
  await env.turns(sid);
  await env.c.call('createItem', env.ws, { kind: 'feature', title: 'Paging', body: 'Cursor based' }, { kind: 'manual' });
  await env.c.call('setState', {
    jobs: [{ id: 'j1', name: 'Weekly summary', workspaceId: env.ws, prompt: 'Summarise {{since}}', schema: '{"type":"object"}', model: env.c.slices.models[0].id, effort: 'low', mode: 'dontAsk', schedule: { kind: 'weekly', time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: true, vars: { since: 'monday' }, missed: 'skip' }, notify: 'never' }],
    hookRules: [{ id: 'h1', name: 'No migrations', event: 'PreToolUse', matcher: 'Edit', action: 'deny', text: 'no', timeout: 10, async: false, enabled: true, scope: 'global' }],
  });
});
after(() => env?.close());

/** Where to go and what proves the page is there. */
const PAGES: Array<[string, string]> = [
  ['/', '.ws-card'], ['/sessions', '.srow'], ['/board', '.board-tabs'], ['/mcp', '.btn'], ['/skills', '.tabs'], ['/hooks', '.hook-ev'],
  ['/jobs', 'textarea'], ['/usage', '.panel'], ['/settings/general', '.form-section'], ['/settings/profiles', '.form-section'],
  ['/settings/permissions', '.settings-main h3'], ['/settings/instructions', '.ext-item'], ['/settings/collaboration', '.form-section'],
  ['/settings/provider', '.form-section'], ['/settings/language', '.form-section'],
];
const INSPECTOR = ['任务', '后台', '变更', '检查点', '上下文', '事件', '文件', '信息'];

/** Visible Chinese text and Chinese in placeholder / title / aria-label. */
const chinese = (p: Page) => p.eval<string[]>(`(() => {
  const han = /[\\u4e00-\\u9fff]/;
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = n.textContent.trim();
    if (t && han.test(t) && n.parentElement && n.parentElement.getClientRects().length) out.push(t.slice(0, 80));
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
    if (!el.getClientRects().length) continue;
    for (const a of ['placeholder', 'title', 'aria-label']) { const v = el.getAttribute(a); if (v && han.test(v)) out.push(a + '=' + v.slice(0, 80)); }
  }
  // Allowed: the Chinese option of the language menu, the Chinese number-style example, the test endpoint's name.
  return [...new Set(out)].filter((t) => t !== '简体中文' && !/1840万|测试端点/.test(t));
})()`);

async function visitAll(p: Page, onEach: (where: string) => Promise<void>) {
  for (const [route, sel] of PAGES) {
    await p.goto(route);
    await p.waitEl(sel);
    await onEach(route);
  }
  await p.goto(`/s/${sid}`);
  await p.waitEl('.c-input');
  await onEach('session');
  for (const tab of INSPECTOR) {
    await p.eval(`(() => { const b = [...document.querySelectorAll('.ins-rail-btn')].find((x) => x.querySelector('span')?.textContent && x.title !== undefined && x.dataset.k === undefined && x.querySelector('span').textContent.trim() === ${JSON.stringify(tab)}); (b ?? document.querySelectorAll('.ins-rail-btn')[${INSPECTOR.indexOf(tab)}]).click(); })()`);
    await new Promise((r) => setTimeout(r, 300));
    await onEach(`session inspector ${INSPECTOR.indexOf(tab) + 1}`);
  }
  await p.click('.top-icon');
  await onEach('inbox');
  await p.goto('/');
  await p.waitEl('.ws-card');
  await p.eval(`document.querySelector('.ws-remove')?.click()`);
  await p.waitEl('.modal');
  await onEach('confirm dialog');
}

/** Visible buttons with neither text nor a title or aria-label: an icon a screen reader cannot name. */
const unnamed = (p: Page) => p.eval<string[]>(`[...document.querySelectorAll('button, [role=button]')]
  .filter((b) => b.getClientRects().length && !b.textContent.trim() && !b.getAttribute('title') && !b.getAttribute('aria-label'))
  .map((b) => b.outerHTML.slice(0, 120))`);

test('every page in Chinese opens without page errors; every button has a name (NFR-07)', async () => {
  const p = await env.page('/');
  const found: string[] = [];
  await visitAll(p, async (where) => {
    for (const b of await unnamed(p)) found.push(`${where}: ${b}`);
  });
  noPageErrors(p);
  await p.close();
  assert.deepEqual([...new Set(found)], [], 'buttons without a name');
});

test('in English no Chinese is left on any page (FR-I18N-01, issue 10-30#11)', async () => {
  await env.c.call('setState', { prefs: { ...env.c.slices.prefs, uiLanguage: 'en' } });
  const p = await env.page('/');
  const found: string[] = [];
  await visitAll(p, async (where) => {
    for (const t of await chinese(p)) found.push(`${where}: ${t}`);
  });
  noPageErrors(p);
  await p.close();
  await env.c.call('setState', { prefs: { ...env.c.slices.prefs, uiLanguage: 'zh-CN' } });
  assert.deepEqual([...new Set(found)], [], 'Chinese left in the English UI');
});
