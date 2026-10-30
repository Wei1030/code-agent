/**
 * A transcript goes to the web app a page at a time: opening a session sends its last items, and
 * scrolling up to the top asks for the page before. The server keeps every item.
 */
import type { EarlierItems, Item, SessionRuntime } from '@code-agent/shared/types';

export const PAGE = 120;

/**
 * Where the page ending at `end` starts: at a prompt, so no turn is cut in two, going back up to
 * half a page further for one; else at the first prompt inside the page; else wherever it falls.
 */
export function pageStart(items: Item[], end: number, size = PAGE): number {
  const start = Math.max(0, end - size);
  if (start === 0) return 0;
  for (let i = start; i >= Math.max(0, start - size / 2); i--) if (items[i].kind === 'user') return i;
  for (let i = start + 1; i < end; i++) if (items[i].kind === 'user') return i;
  return start;
}

/** What is before the first `start` items: how many, and the prompts among them (for numbering and checkpoints). */
export function earlierOf(items: Item[], start: number): EarlierItems | undefined {
  if (start <= 0) return undefined;
  const users = items.slice(0, start).flatMap((x) => (x.kind === 'user' ? [{ id: x.id, text: x.text.slice(0, 200), ts: x.ts }] : []));
  return { items: start, users };
}

/** The runtime as a session opens: its last page of items. */
export function lastPage(r: SessionRuntime, size = PAGE): SessionRuntime {
  const start = pageStart(r.items, r.items.length, size);
  return { ...r, items: r.items.slice(start), earlier: earlierOf(r.items, start) };
}

/** The page before an item, and what is still before that. */
export function pageBefore(items: Item[], beforeId: string, size = PAGE): { items: Item[]; earlier?: EarlierItems } {
  const end = items.findIndex((x) => x.id === beforeId);
  if (end <= 0) return { items: [] };
  const start = pageStart(items, end, size);
  return { items: items.slice(start, end), earlier: earlierOf(items, start) };
}
