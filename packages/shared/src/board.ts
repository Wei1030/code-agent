/** Board vocabulary shared by the page, the transcript and the backend. */
import type { BoardKind, BoardStatus } from './types';

export const PREFIX: Record<BoardKind, string> = { feature: 'F', issue: 'I', note: 'N' };
export const KIND_LABEL: Record<BoardKind, string> = { feature: '功能', issue: '问题', note: '笔记' };
export const KIND_ICON: Record<BoardKind, string> = { feature: 'flag', issue: 'warning', note: 'file' };
export const FIRST_STATUS: Record<BoardKind, BoardStatus> = { feature: 'todo', issue: 'open', note: 'active' };

export const STATUSES: Record<BoardKind, BoardStatus[]> = {
  feature: ['todo', 'doing', 'done', 'dropped'],
  issue: ['open', 'confirmed', 'fixing', 'fixed', 'wontfix'],
  note: ['active', 'outdated'],
};

export const STATUS_LABEL: Record<BoardStatus, string> = {
  todo: '待开始', doing: '进行中', done: '已完成', dropped: '已放弃',
  open: '待处理', confirmed: '已确认', fixing: '修复中', fixed: '已修复', wontfix: '不修',
  active: '有效', outdated: '已过时',
};

export const STATUS_TONE: Partial<Record<BoardStatus, 'accent' | 'warn' | 'good' | 'crit'>> = {
  doing: 'accent', fixing: 'accent', open: 'warn', confirmed: 'warn', done: 'good', fixed: 'good',
};

/** Finished states: the item no longer needs attention. */
export const CLOSED: BoardStatus[] = ['done', 'dropped', 'fixed', 'wontfix', 'outdated'];

/** Board ids in free text: F-3, I-12, N-4 (not part of a longer word or number). */
export const ID_SPLIT = /((?<![A-Za-z0-9-])[FIN]-\d+(?!\d))/;

export const boardPath = (wsId: string, id?: string) => `/board?ws=${wsId}${id ? `&item=${id}` : ''}`;
