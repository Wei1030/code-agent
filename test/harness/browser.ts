/**
 * Headless Chrome over the DevTools protocol, for UI tests. Each page gets recorders installed
 * before the app loads: system notifications, the clipboard, downloads and the app's WebSockets
 * (so a test can cut the connection). Page errors are collected; tests fail on them.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { freePort } from './server';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs in every page before the app: helpers and recorders. */
const INIT = String.raw`
window.__find = (sel, text, nth = 0) => {
  const all = [...document.querySelectorAll(sel || '*')].filter((e) => {
    if (text != null && !e.textContent.includes(text)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const inner = text != null ? all.filter((e) => !all.some((o) => o !== e && e.contains(o))) : all;
  return inner[nth] || null;
};
window.__texts = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
window.__notifications = [];
window.__permissionAsked = 0;
window.__perm = 'granted';
class FakeNotification {
  constructor(title, opts) { this.title = title; this.opts = opts || {}; window.__notifications.push(this); }
  close() { this.closed = true; }
  static get permission() { return window.__perm; }
  static requestPermission() { window.__permissionAsked += 1; return Promise.resolve(window.__perm); }
}
window.Notification = FakeNotification;
window.__clipboard = [];
try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__clipboard.push(t); return Promise.resolve(); }, readText: () => Promise.resolve(window.__clipboard.at(-1) || '') } }); } catch {}
window.__away = false;
document.hasFocus = () => !window.__away;
Object.defineProperty(document, 'hidden', { get: () => window.__away });
window.__sockets = [];
const RealWS = window.WebSocket;
window.WebSocket = class extends RealWS { constructor(...a) { super(...a); window.__sockets.push(this); } };
`;

interface Pending { res: (m: any) => void }

export class Page {
  errors: string[] = [];
  private id = 0;
  private pending = new Map<number, Pending>();
  private ws!: WebSocket;

  constructor(readonly browser: Browser, readonly targetId: string, private wsUrl: string) {}

  async attach(): Promise<this> {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((r) => this.ws.addEventListener('open', r, { once: true }));
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!.res(m); this.pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' '));
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
    await this.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: this.browser.downloads, eventsEnabled: true }).catch(() => undefined);
    return this;
  }

  send(method: string, params: object = {}): Promise<any> {
    return new Promise((res) => {
      this.id += 1;
      this.pending.set(this.id, { res });
      this.ws.send(JSON.stringify({ id: this.id, method, params }));
    });
  }

  async eval<T = unknown>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 120)}: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value as T;
  }

  /** Open an app path and wait for the app to be connected. */
  async goto(p: string) {
    await this.send('Page.navigate', { url: this.browser.base + p });
    await this.waitFor(`!document.querySelector('.boot') && !!document.querySelector('.topbar')`, 'app loaded', 30_000);
  }

  async reload() {
    await this.send('Page.reload', { ignoreCache: false });
    await sleep(300);
    await this.waitFor(`!document.querySelector('.boot') && !!document.querySelector('.topbar')`, 'app reloaded', 30_000);
  }

  /** Wait until a page expression is truthy; returns its value. */
  async waitFor<T = unknown>(expr: string, what = expr, ms = 20_000): Promise<T> {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      try {
        const v = await this.eval<T>(expr);
        if (v) return v;
      } catch (e) { last = e instanceof Error ? e.message : String(e); }
      await sleep(150);
    }
    const shot = await this.shot(`timeout-${Date.now()}`);
    throw new Error(`timed out waiting for ${what}${last ? ` (${last})` : ''}; screenshot ${shot}`);
  }

  /** Wait for a visible element matching the selector (and containing the text). */
  waitEl(sel: string, text?: string, ms?: number) {
    return this.waitFor(`!!__find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)})`, `${sel}${text ? ` "${text}"` : ''}`, ms);
  }

  async gone(sel: string, text?: string, ms?: number) {
    await this.waitFor(`!__find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)})`, `no ${sel}${text ? ` "${text}"` : ''}`, ms);
  }

  has(sel: string, text?: string) {
    return this.eval<boolean>(`!!__find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)})`);
  }

  text(sel: string) {
    return this.eval<string>(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').trim()`);
  }

  texts(sel: string) {
    return this.eval<string[]>(`__texts(${JSON.stringify(sel)})`);
  }

  /** Click the innermost visible element matching the selector and text, with a real mouse event. */
  async click(sel: string, text?: string, nth = 0) {
    await this.waitEl(sel, text);
    const box = await this.eval<number[]>(`(() => { const e = __find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)}, ${nth}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const [x, y] = box;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(80);
  }

  async hover(sel: string, text?: string) {
    await this.waitEl(sel, text);
    const [x, y] = await this.eval<number[]>(`(() => { const e = __find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? null)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(80);
  }

  /** Focus a field and type into it as keystrokes. */
  async type(sel: string, text: string) {
    await this.focus(sel);
    await this.send('Input.insertText', { text });
    await sleep(50);
  }

  async focus(sel: string) {
    await this.waitEl(sel);
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); if (e.setSelectionRange) e.setSelectionRange(e.value.length, e.value.length); })()`);
  }

  /** Replace a field's value (React sees an input event). */
  async fill(sel: string, value: string) {
    await this.waitEl(sel);
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.focus(); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }

  value(sel: string) {
    return this.eval<string>(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);
  }

  /** A key press: Enter, Escape, ArrowDown, Tab… with modifiers (1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
  async press(key: string, modifiers = 0) {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, Backspace: 8 };
    const base = { key, code: key, windowsVirtualKeyCode: codes[key] ?? 0, modifiers };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (key === 'Enter') await this.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r', unmodifiedText: '\r' });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(80);
  }

  /** Type with an input method: compose `reading`, press Enter while composing, then commit `text`. */
  async imeEnter(sel: string, reading: string, text: string) {
    await this.focus(sel);
    await this.send('Input.imeSetComposition', { text: reading, selectionStart: reading.length, selectionEnd: reading.length });
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'Enter', windowsVirtualKeyCode: 229 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await this.send('Input.insertText', { text });
    await sleep(80);
  }

  /** Drop the app's WebSocket connections, as if the network went away. */
  cutConnection() {
    return this.eval(`window.__sockets.forEach((s) => s.close()); window.__sockets.length`);
  }

  /** Make the tab look like it is in the background (no focus, hidden). */
  away(on: boolean) {
    return this.eval(`window.__away = ${on}; document.dispatchEvent(new Event('visibilitychange'))`);
  }

  async shot(name: string): Promise<string> {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(this.browser.dir, `${name}.png`);
    if (r.result?.data) writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    return f;
  }

  async close() {
    await this.browser.closeTarget(this.targetId);
    this.ws.close();
  }
}

export class Browser {
  private proc: ChildProcess | null = null;
  private port = 0;
  pages: Page[] = [];
  readonly downloads: string;

  constructor(readonly dir: string, readonly base: string, private lang = 'zh-CN') {
    this.downloads = path.join(dir, 'downloads');
    mkdirSync(this.downloads, { recursive: true });
  }

  async start(): Promise<this> {
    this.port = await freePort();
    this.proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${this.port}`, `--user-data-dir=${path.join(this.dir, 'chrome')}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', `--lang=${this.lang}`, `--accept-lang=${this.lang}`, 'about:blank'], { stdio: 'ignore' });
    const t0 = Date.now();
    while (Date.now() - t0 < 20_000) {
      try {
        await fetch(`http://127.0.0.1:${this.port}/json/version`);
        return this;
      } catch { await sleep(200); }
    }
    throw new Error('chrome did not start');
  }

  /** A new tab with the recorders installed, at an app path. */
  async page(p = '/'): Promise<Page> {
    const t = await (await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' })).json() as { id: string; webSocketDebuggerUrl: string };
    const page = await new Page(this, t.id, t.webSocketDebuggerUrl).attach();
    this.pages.push(page);
    await page.goto(p);
    return page;
  }

  async closeTarget(id: string) {
    await fetch(`http://127.0.0.1:${this.port}/json/close/${id}`).catch(() => undefined);
  }

  close() {
    const p = this.proc;
    this.proc = null;
    if (!p?.pid) return;
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else p.kill('SIGKILL');
    } catch { /* gone */ }
  }
}
