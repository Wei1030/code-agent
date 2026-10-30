// The harness itself: a session runs on the scripted endpoint inside the test world.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { setup, type Env } from '../harness/env';
import { say, use } from '../harness/fake-model';

let env: Env;
before(async () => { env = await setup({ files: { 'notes.txt': 'hello\n' } }); });
after(() => env?.close());

test('a session answers from the script and its transcript stays in the test world', async () => {
  env.model.script(/读一下 notes/, [[say('我先读一下。'), use('Read', { file_path: '{cwd}/notes.txt' })], [say('文件里写着 hello。')]]);
  const sid = await env.start('读一下 notes.txt');
  await env.turns(sid);
  const rt = await env.rt(sid);
  const texts = rt.items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
  assert.deepEqual(texts, ['我先读一下。', '文件里写着 hello。']);
  assert.ok(rt.items.some((i) => i.kind === 'footer'), 'turn footer');
  const req = env.model.sent(/读一下 notes/)[0];
  assert.equal(req.model, 'model-one');
  assert.equal(req.headers.authorization, 'Bearer test-token');
  const projects = path.join(env.world.config, 'projects');
  assert.ok(readdirSync(projects).length > 0, 'Claude Code wrote its transcript under the test home');
});
