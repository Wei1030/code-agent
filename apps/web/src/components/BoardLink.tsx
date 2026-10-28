/** Board ids (F-3, I-12, N-4) in text: links to the board, with a preview on hover. */
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoardItem } from '../api/types';
import { useApp } from '../store/app';
import { boardPath, CLOSED, ID_SPLIT, KIND_ICON, KIND_LABEL, STATUS_LABEL, STATUS_TONE } from '../lib/board';
import { cx } from '../lib/util';
import { useT } from '../lib/i18n';
import { Icon } from './Icon';
import { Chip, Popover } from './ui';

/** Turn the board ids in `text` that exist on the workspace's board into links. */
export function linkify(text: string, wsId: string | undefined): ReactNode {
  if (!wsId || !ID_SPLIT.test(text)) return text;
  return text.split(ID_SPLIT).map((p, i) => (i % 2 === 1 ? <BoardLink key={i} id={p} wsId={wsId} /> : <Fragment key={i}>{p}</Fragment>));
}

export function BoardLink({ id, wsId }: { id: string; wsId: string }) {
  const item = useApp((s) => s.board.find((x) => x.workspaceId === wsId && x.id === id));
  const nav = useNavigate();
  const ref = useRef<HTMLAnchorElement>(null);
  const [hover, setHover] = useState(false);
  if (!item) return <>{id}</>;
  return (
    <>
      <a ref={ref} className={cx('board-link', CLOSED.includes(item.status) && 'closed')}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onClick={(e) => { e.stopPropagation(); setHover(false); nav(boardPath(wsId, id)); }}>{id}</a>
      <Popover anchor={ref.current} open={hover} onClose={() => setHover(false)} placement="top-start" width={340} className="board-peek">
        <BoardPeek item={item} />
      </Popover>
    </>
  );
}

function BoardPeek({ item }: { item: BoardItem }) {
  const t = useT();
  const done = item.tasks.filter((x) => x.done).length;
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <Icon name={KIND_ICON[item.kind]} size={14} className="muted" />
        <b className="mono">{item.id}</b>
        <span className="muted">{t(KIND_LABEL[item.kind])}</span>
        <span className="grow" />
        <Chip tone={STATUS_TONE[item.status]}>{t(STATUS_LABEL[item.status])}</Chip>
      </div>
      <div className="t">{item.title}</div>
      {item.body && <div className="d">{item.body.length > 120 ? `${item.body.slice(0, 120)}…` : item.body}</div>}
      {item.tasks.length > 0 && <div className="muted">{t('任务 {d}/{n}', { d: done, n: item.tasks.length })}</div>}
      <div className="muted">{t('点击在看板中打开')}</div>
    </>
  );
}
