// Regenerates the prototype from the real app: builds the demo world, starts the demo model and a
// Code Agent on its own data dir, drives it into every state, then screenshots each screen of
// screens.mjs with headless Chrome and records where its numbered marks go.
//   node docs/prototype/tools/shoot.mjs [screen ids…]      (all screens when none given)
// SHOOT_KEEP=1 leaves the demo model and server running afterwards; SHOOT_REUSE=1 then shoots again
// from that running demo without rebuilding it (for working on screens.mjs).
// Needs Chrome (CHROME env to point elsewhere). Output: docs/prototype/shots/*.webp, screens.js.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './client.mjs';
import { drive } from './drive.mjs';
import { SCREENS } from './screens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const OUT = path.resolve(here, '..');
const DEMO = process.env.DEMO_DIR ?? 'C:/tmp/code-agent-demo';
const PORT = Number(process.env.DEMO_PORT ?? 5190);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = 1440, H = 900;
const only = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEEP = !!process.env.SHOOT_KEEP;
const REUSE = !!process.env.SHOOT_REUSE;
const children = [];

function run(cmd, args, env, name, keep = false) {
  const fd = openSync(path.join(DEMO, `${name}.log`), 'a');
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], detached: keep });
  if (keep) p.unref();
  else children.push(p);
  return p;
}
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch { /* not yet */ } await sleep(300); }
  throw new Error(`timed out: ${what}`);
}

// ------------------------------------------------------------------ Chrome over CDP
async function chrome() {
  const port = 9400 + Math.floor(Math.random() * 400);
  run(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(DEMO, 'chrome')}`, `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', '--lang=zh-CN', '--hide-scrollbars', 'about:blank'], {}, 'chrome');
  let page;
  await until(async () => { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); return page; }, 20_000, 'chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((res) => { id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // Headless pages never have focus; focused inputs (the composer's palettes) need it.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  const base = `http://127.0.0.1:${PORT}`;
  // A full load every time: no dialog, popover or scroll position carries over from the screen before.
  const go = async (p) => {
    await send('Page.navigate', { url: base + p });
    await sleep(2200);
  };
  return { send, evaluate, go, errors, close: () => ws.close() };
}

// In-page helpers: find an element by selector and/or text, click it, read its box.
const PAGE_LIB = `
window.__find = (sel, text, nth = 0) => {
  const all = [...document.querySelectorAll(sel || '*')].filter((e) => {
    if (text && !e.textContent.includes(text)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  // The innermost matches: drop elements that contain another match.
  const inner = text ? all.filter((e) => !all.some((o) => o !== e && e.contains(o))) : all;
  return inner[nth] || null;
};
window.__box = (sel, text, nth) => { const e = window.__find(sel, text, nth); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
if (!document.getElementById('shoot-css')) { const s = document.createElement('style'); s.id = 'shoot-css'; s.textContent = '.toasts { display: none !important; }'; document.head.appendChild(s); }
window.__click = (sel, text, nth) => { const e = window.__find(sel, text, nth); if (!e) throw new Error('no element ' + sel + ' ' + (text || '')); e.scrollIntoView({ block: 'center' }); e.click(); return true; };
`;

async function capture(b, c, ids, screens) {
  mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const results = [];
  for (const sc of screens) {
    await b.evaluate(PAGE_LIB);
    const ctx = {
      ids, call: c.call, sleep,
      summary: (id) => c.state.sessions.get(id),
      slices: () => c.state.slices,
      go: (p) => b.go(p).then(() => b.evaluate(PAGE_LIB)),
      click: (sel, text, nth) => b.evaluate(`__click(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)}, ${nth ?? 0})`),
      eval: (expr) => b.evaluate(expr),
      type: async (sel, value) => b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.focus(); e.setSelectionRange?.(e.value.length, e.value.length); e.dispatchEvent(new Event('input', { bubbles: true })); })()`),
      key: (k) => b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k }).then(() => b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k })),
      inject: (sel, text, where, html) => b.evaluate(`(() => {
        const e = __find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)});
        if (!e) throw new Error('inject target missing: ${String(sel).replace(/'/g, '')}');
        const t = document.createElement('template'); t.innerHTML = ${JSON.stringify(html)};
        const node = t.content.firstElementChild;
        if (${JSON.stringify(where)} === 'replace') e.replaceWith(node); else e.insertAdjacentElement(${JSON.stringify(where ?? 'beforeend')}, node);
        return true;
      })()`),
    };
    try {
      await sc.prepare(ctx);
      await sleep(sc.settle ?? 500);
      await b.evaluate(PAGE_LIB);
      const marks = [];
      for (const [i, m] of (sc.marks ?? []).entries()) {
        const box = m.sel || m.text ? await b.evaluate(`__box(${JSON.stringify(m.sel ?? null)}, ${JSON.stringify(m.text ?? null)}, ${m.nth ?? 0})`) : null;
        if ((m.sel || m.text) && !box) console.warn(`  ${sc.id} mark ${i + 1} not found: ${m.sel ?? ''} ${m.text ?? ''}`);
        marks.push({ box, at: m.at ?? 'tl', note: m.note, isNew: !!m.isNew });
      }
      const shot = await b.send('Page.captureScreenshot', { format: 'webp', quality: 86 });
      writeFileSync(path.join(OUT, 'shots', `${sc.id}.webp`), Buffer.from(shot.result.data, 'base64'));
      results.push({ id: sc.id, marks });
      console.log(`shot ${sc.id}`);
      if (sc.after) await sc.after(ctx);
    } catch (e) {
      console.error(`  ${sc.id} failed: ${e.message}`);
      results.push({ id: sc.id, marks: [], error: e.message });
    }
  }
  return results;
}

async function main() {
  const idsFile = path.join(DEMO, 'ids.json');
  let ids;
  let c;
  if (REUSE) {
    ids = JSON.parse(readFileSync(idsFile, 'utf8'));
    c = await connect(PORT);
  } else {
    execFileSync(process.execPath, [path.join(here, 'setup.mjs')], { stdio: 'inherit', env: { ...process.env, DEMO_DIR: DEMO } });
    run(process.execPath, [path.join(here, 'demo-llm.mjs')], { DEMO_LLM_LOG: path.join(DEMO, 'llm-requests.log') }, 'demo-llm', KEEP);
    run(process.execPath, ['--import', 'tsx', path.join(ROOT, 'apps/server/src/start.ts'), '--dev'], { CODE_AGENT_HOME: path.join(DEMO, 'home'), CODE_AGENT_PORT: String(PORT), CODE_AGENT_NO_OPEN: '1', CODE_AGENT_NO_PROBE: '1' }, 'server', KEEP);
    await until(() => fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok), 60_000, 'server');
    c = await connect(PORT);
    ids = await drive(c, DEMO);
    writeFileSync(idsFile, JSON.stringify(ids, null, 2));
  }
  const b = await chrome();
  await b.go('/');
  const screens = SCREENS.filter((s) => !only.length || only.includes(s.id));
  const shots = await capture(b, c, ids, screens);
  if (b.errors.length) console.warn('page errors:', b.errors.slice(0, 5));
  // Merge with screens shot earlier when only some were taken now.
  const file = path.join(OUT, 'screens.js');
  const prev = only.length && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^window\.SCREENS = /, '').replace(/;\s*$/, '')) : [];
  const byId = new Map(prev.map((s) => [s.id, s]));
  for (const sc of SCREENS) {
    const shot = shots.find((x) => x.id === sc.id);
    if (!shot) continue;
    byId.set(sc.id, { id: sc.id, group: sc.group, title: sc.title, status: sc.status, summary: sc.summary, frs: sc.frs ?? [], marks: shot.marks, error: shot.error, snippet: sc.snippet });
  }
  const ordered = SCREENS.map((s) => byId.get(s.id)).filter(Boolean);
  writeFileSync(file, `window.SCREENS = ${JSON.stringify(ordered, null, 1)};\n`);
  console.log(`wrote ${ordered.length} screens`);
  b.close();
  c.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  // The whole tree: sessions' Claude Code processes, their commands and MCP servers hold the demo dir.
  for (const p of children) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else p.kill();
    } catch { /* gone */ }
  }
  setTimeout(() => process.exit(), 1500);
});
