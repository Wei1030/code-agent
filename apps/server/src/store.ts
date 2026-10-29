/**
 * Code Agent's own data in one SQLite database (`~/.code-agent/code-agent.db`, Node's built-in
 * node:sqlite, WAL). Settings and small documents are key/value rows; session transcripts are one
 * row per item, so a long session writes only what changed; transcript text is indexed for search.
 * Writes are debounced and grouped in transactions.
 */
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HOME } from './paths';

export const db = new DatabaseSync(path.join(HOME, 'code-agent.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, summary TEXT NOT NULL, last_active INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS runtimes (id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, meta TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS items (
    session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (session, seq)
  );
  CREATE INDEX IF NOT EXISTS items_by_id ON items(session, id);
  CREATE VIRTUAL TABLE IF NOT EXISTS item_text USING fts5(session UNINDEXED, item UNINDEXED, text, tokenize = 'trigram');
  CREATE TABLE IF NOT EXISTS board_items (workspace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (workspace, id));
`);

const pending = new Map<string, { timer: NodeJS.Timeout; write: () => void }>();

/** Run `fn` in one transaction. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const kvGet = db.prepare('SELECT value FROM kv WHERE key = ?');
const kvPut = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const kvDel = db.prepare('DELETE FROM kv WHERE key = ?');

export function load<T>(key: string, def: T): T {
  const row = kvGet.get(key) as { value: string } | undefined;
  if (!row) return def;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return def;
  }
}

/** Write something soon; whatever is current when the write happens wins. */
export function later(key: string, write: () => void, delay = 400) {
  const prev = pending.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    try {
      write();
    } catch (e) {
      console.error(`[store] cannot write ${key}:`, e);
    }
  }, delay);
  pending.set(key, { timer, write });
}

/** Save a key/value row soon; `data` is read when the write happens. */
export function save(key: string, data: () => unknown, delay = 400) {
  later(`kv:${key}`, () => kvPut.run(key, JSON.stringify(data())), delay);
}

export function remove(key: string) {
  const prev = pending.get(`kv:${key}`);
  if (prev) clearTimeout(prev.timer);
  pending.delete(`kv:${key}`);
  kvDel.run(key);
}

/** Write everything still pending (on shutdown). */
export function flush() {
  for (const [key, p] of pending) {
    clearTimeout(p.timer);
    try {
      p.write();
    } catch (e) {
      console.error(`[store] cannot write ${key}:`, e);
    }
  }
  pending.clear();
}
