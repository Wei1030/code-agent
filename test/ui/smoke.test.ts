// The browser half of the harness: the real web app sends a message and shows the scripted answer.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupUi, noPageErrors, type UiEnv } from '../harness/ui';
import { say } from '../harness/fake-model';

let env: UiEnv;
before(async () => { env = await setupUi(); });
after(() => env?.close());

test('Enter sends from the composer, Enter while composing with an input method does not (FR-IN-01, FR-I18N-07)', async () => {
  env.model.script(/你好/, [[say('你好，我在。')]]);
  const p = await env.page('/');
  await p.click('.ws-card');
  await p.waitEl('.c-input');
  await p.eval(`window.__keys = []; document.addEventListener('keydown', (e) => __keys.push([e.keyCode, e.isComposing]), true)`);
  await p.imeEnter('.c-input', 'nihao', '你好');
  const keys = await p.eval<Array<[number, boolean]>>('__keys');
  assert.ok(keys.some(([code, composing]) => code === 229 || composing), `the page saw the Enter of the input method: ${JSON.stringify(keys)}`);
  assert.equal(await p.value('.c-input'), '你好', 'the composed text is in the box and nothing was sent');
  await p.press('Enter');
  await p.waitEl('.transcript *', '你好，我在。');
  assert.equal(await p.value('.c-input'), '');
  noPageErrors(p);
});
