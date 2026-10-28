/** JSON files in the data directory, written atomically and debounced. */
import { readFileSync, renameSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { HOME } from './paths';

const pending = new Map<string, { timer: NodeJS.Timeout; data: () => unknown }>();

function file(name: string) {
  return path.isAbsolute(name) ? name : path.join(HOME, name);
}

export function load<T>(name: string, def: T): T {
  try {
    return JSON.parse(readFileSync(file(name), 'utf8')) as T;
  } catch {
    return def;
  }
}

function writeNow(name: string, data: unknown) {
  const f = file(name);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, f);
}

/** Save soon; `data` is read when the write happens, so the latest state wins. */
export function save(name: string, data: () => unknown, delay = 400) {
  const prev = pending.get(name);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pending.delete(name);
    try {
      writeNow(name, data());
    } catch (e) {
      console.error(`[store] cannot write ${name}:`, e);
    }
  }, delay);
  pending.set(name, { timer, data });
}

export function remove(name: string) {
  const prev = pending.get(name);
  if (prev) clearTimeout(prev.timer);
  pending.delete(name);
  if (existsSync(file(name))) rmSync(file(name), { force: true });
}

/** Write everything still pending (on shutdown). */
export function flush() {
  for (const [name, p] of pending) {
    clearTimeout(p.timer);
    try {
      writeNow(name, p.data());
    } catch (e) {
      console.error(`[store] cannot write ${name}:`, e);
    }
  }
  pending.clear();
}
