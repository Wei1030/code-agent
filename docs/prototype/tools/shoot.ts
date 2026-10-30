// Regenerates the prototype from the real app on the test harness: builds the demo world, plays
// scenarios.mjs on the scripted endpoint, starts Code Agent on the built web app, drives it into
// every state, then screenshots each screen of screens.mjs with headless Chrome and records where
// its numbered marks go. Strict: a screen that fails or a mark that is not found fails the run.
//   node --import tsx docs/prototype/tools/shoot.ts [screen ids…]      (all screens when none given)
// SHOOT_KEEP=1 keeps the demo running afterwards and shoots again whenever screens.mjs changes
// (the screens given, or all): the quick loop when editing screens.
// Output: docs/prototype/shots/*.webp, docs/prototype/screens.js.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, watch, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FakeModel, type Block, type Req, type Step } from '../../../test/harness/fake-model';
import { Server } from '../../../test/harness/server';
import { Client } from '../../../test/harness/client';
import { Browser, type Page } from '../../../test/harness/browser';
import { demoWorld } from './world';
import { drive, type Ids } from './drive';
import { SCENARIOS, structured } from './scenarios.mjs';

const here = import.meta.dirname;
const ROOT = path.resolve(here, '../../..');
const OUT = path.resolve(here, '..');
const DEMO = process.env.DEMO_DIR ?? 'C:/tmp/code-agent-demo';
const only = process.argv.slice(2);
const KEEP = !!process.env.SHOOT_KEEP;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Mark { sel?: string; text?: string; nth?: number; at?: string; isNew?: boolean; note: string[] }
interface Screen {
  id: string; group: string; title: string; status: string; summary: string; frs?: string[]; snippet?: string; settle?: number;
  prepare(ctx: Ctx): Promise<void>; after?(ctx: Ctx): Promise<void>; marks?: Mark[];
}
interface Ctx {
  ids: Ids; sleep: typeof sleep;
  call: Client['call']; summary: (id: string) => unknown; slices: () => Client['slices'];
  go(p: string): Promise<void>; click(sel: string, text?: string | null, nth?: number): Promise<unknown>;
  eval(expr: string): Promise<unknown>; type(sel: string, value: string): Promise<unknown>; key(k: string): Promise<void>;
  inject(sel: string, text: string | null, where: string, html: string): Promise<unknown>;
  hover(sel: string, text?: string): Promise<void>;
  /** Cut the page's connection to the server and keep it cut (true), or let it reconnect. */
  offline(on: boolean): Promise<unknown>;
}

/** The scenarios' steps for the scripted endpoint: blocks may be functions of the prompt; Bash becomes PowerShell where Claude Code offers that. */
function register(model: FakeModel) {
  const shellFor = (r: Req, b: Block): Block => (b.type === 'tool_use' && b.name === 'Bash' && !r.tools.includes('Bash') ? { ...b, name: 'PowerShell' } : b);
  type DemoBlock = Block | ((prompt: string, req: Req) => Block);
  for (const sc of [...SCENARIOS].reverse() as Array<{ match: RegExp; steps: DemoBlock[][] }>) {
    model.script(sc.match, sc.steps.map((step): Step => (r) => step.map((b) => shellFor(r, typeof b === 'function' ? b(r.prompt, r) : b))));
  }
  model.structured((schema, r) => {
    const out = structured(schema, r.prompt, r.step) as { blocks?: Block[]; output?: unknown };
    return out.blocks ? { blocks: out.blocks.map((b) => shellFor(r, b)) } : out;
  });
  model.failModel('expired-1', { fault: 'http', status: 401, errorType: 'authentication_error', message: 'API key expired.' });
}

// In-page helpers on top of the harness's __find: a box, a click, no toasts in the shots (unless a screen sets __toasts).
const PAGE_LIB = `
window.__box = (sel, text, nth) => { const e = window.__find(sel, text, nth); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
window.__click = (sel, text, nth) => { const e = window.__find(sel, text, nth); if (!e) throw new Error('no element ' + sel + ' ' + (text || '')); e.scrollIntoView({ block: 'center' }); e.click(); return true; };
if (!window.__toasts && !document.getElementById('shoot-css')) { const s = document.createElement('style'); s.id = 'shoot-css'; s.textContent = '.toasts { display: none !important; }'; document.head.appendChild(s); }
`;

function context(page: Page, c: Client, ids: Ids): Ctx {
  return {
    ids, sleep, call: c.call.bind(c), summary: (id) => c.sessions.get(id), slices: () => c.slices,
    async go(p) { await page.goto(p); await sleep(700); await page.eval(PAGE_LIB); },
    click: (sel, text, nth) => page.eval(`__click(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)}, ${nth ?? 0})`),
    eval: (expr) => page.eval(expr),
    type: (sel, value) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.focus(); e.setSelectionRange?.(e.value.length, e.value.length); e.dispatchEvent(new Event('input', { bubbles: true })); })()`),
    key: (k) => page.press(k),
    hover: (sel, text) => page.hover(sel, text),
    offline: (on) => (on ? page.cutConnection(true) : page.online()),
    inject: (sel, text, where, html) => page.eval(`(() => {
      const e = __find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)});
      if (!e) throw new Error('inject target missing: ${String(sel).replace(/'/g, '')}');
      const t = document.createElement('template'); t.innerHTML = ${JSON.stringify(html)};
      const node = t.content.firstElementChild;
      if (${JSON.stringify(where)} === 'replace') e.replaceWith(node); else e.insertAdjacentElement(${JSON.stringify(where ?? 'beforeend')}, node);
      return true;
    })()`),
  };
}

async function capture(page: Page, c: Client, ids: Ids, screens: Screen[]) {
  mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const results: Array<{ id: string; marks: unknown[]; error?: string }> = [];
  const problems: string[] = [];
  const ctx = context(page, c, ids);
  for (const sc of screens) {
    try {
      await page.eval(PAGE_LIB);
      await sc.prepare(ctx);
      await sleep(sc.settle ?? 500);
      await page.eval(PAGE_LIB);
      const marks = [];
      for (const [i, m] of (sc.marks ?? []).entries()) {
        const box = m.sel || m.text ? await page.eval(`__box(${JSON.stringify(m.sel ?? null)}, ${JSON.stringify(m.text ?? null)}, ${m.nth ?? 0})`) : null;
        if ((m.sel || m.text) && !box) problems.push(`${sc.id} mark ${i + 1} not found: ${m.sel ?? ''} ${m.text ?? ''}`);
        marks.push({ box, at: m.at ?? 'tl', note: m.note, isNew: !!m.isNew });
      }
      const shot = await page.send('Page.captureScreenshot', { format: 'webp', quality: 86 });
      writeFileSync(path.join(OUT, 'shots', `${sc.id}.webp`), Buffer.from(shot.result.data, 'base64'));
      results.push({ id: sc.id, marks });
      console.log(`shot ${sc.id}`);
      if (sc.after) await sc.after(ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      problems.push(`${sc.id} failed: ${msg}`);
      results.push({ id: sc.id, marks: [], error: msg });
    }
  }
  return { results, problems };
}

function writeScreens(all: Screen[], results: Array<{ id: string; marks: unknown[]; error?: string }>, partial: boolean) {
  const file = path.join(OUT, 'screens.js');
  const prev = partial && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^window\.SCREENS = /, '').replace(/;\s*$/, '')) as Array<{ id: string }> : [];
  const byId = new Map<string, unknown>(prev.map((s) => [s.id, s]));
  for (const sc of all) {
    const shot = results.find((x) => x.id === sc.id);
    if (shot) byId.set(sc.id, { id: sc.id, group: sc.group, title: sc.title, status: sc.status, summary: sc.summary, frs: sc.frs ?? [], marks: shot.marks, error: shot.error, snippet: sc.snippet });
  }
  const ordered = all.map((s) => byId.get(s.id)).filter(Boolean);
  writeFileSync(file, `window.SCREENS = ${JSON.stringify(ordered, null, 1)};\n`);
  console.log(`wrote ${ordered.length} screens`);
}

async function loadScreens(n = 0): Promise<Screen[]> {
  return (await import(`${pathToFileURL(path.join(here, 'screens.mjs')).href}?v=${n}`)).SCREENS as Screen[];
}

/** A run cut short (Ctrl+C, a crash) can leave the demo's long command (scripts/bench.js) holding the demo folder. */
function endLeftovers() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'scripts/bench.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' });
  } catch { /* nothing left */ }
}

async function main() {
  endLeftovers();
  if (!process.env.SHOOT_NO_BUILD) execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '-w', '@code-agent/web'], { cwd: ROOT, stdio: 'inherit', shell: true });
  const world = demoWorld(DEMO);
  const model = await new FakeModel().start();
  register(model);
  const server = await new Server(world, { web: true }).start();
  const c = await new Client(server.port).connect();
  const browser = await new Browser(path.join(DEMO, 'browser'), server.url).start();
  const stop = async () => {
    browser.close();
    // Saved one by one, Claude Code ends what it started; a killed server would leave commands running in the demo folder.
    await Promise.all([...c.sessions.values()].filter((s) => s.live).map((s) => Promise.race([c.call('stop', s.id), sleep(8000)]).catch(() => undefined)));
    c.close();
    server.kill();
    await model.close();
  };
  try {
    const ids = await drive(c, model, world);
    writeFileSync(path.join(DEMO, 'ids.json'), JSON.stringify(ids, null, 2));
    const page = await browser.page('/');
    const shoot = async (n: number) => {
      const all = await loadScreens(n);
      const screens = all.filter((s) => !only.length || only.includes(s.id));
      const { results, problems } = await capture(page, c, ids, screens);
      if (page.errors.length) problems.push(...page.errors.splice(0).map((e) => `page error: ${e.split('\n')[0]}`));
      writeScreens(all, results, only.length > 0);
      if (problems.length) console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
      return problems.length;
    };
    const failed = await shoot(0);
    if (!KEEP) {
      process.exitCode = failed ? 1 : 0;
      return;
    }
    console.log(`\ndemo running at ${server.url}; editing screens.mjs shoots again (Ctrl+C to stop)`);
    let n = 0;
    let busy = false;
    watch(path.join(here, 'screens.mjs'), async () => {
      if (busy) return;
      busy = true;
      await sleep(300);
      try { await shoot(++n); } finally { busy = false; }
    });
    await new Promise(() => undefined);
  } finally {
    if (!KEEP) {
      await stop();
      endLeftovers();
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { if (!KEEP) setTimeout(() => process.exit(), 1500); });
