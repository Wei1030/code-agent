/** Transcript items: messages, thinking, tool cards, plans, banners and notices. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Item, PeerCall, PlanDoc, SessionRef, SessionRuntime, ToolItem } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, Chip } from '../components/ui';
import { api } from '../api';
import { useApp } from '../store/app';
import { duration, tokens } from '../lib/format';
import { cx } from '../lib/util';
import { useT } from '../lib/i18n';
import { ReviewCard } from './Review';
import { BoardLink, linkify } from '../components/BoardLink';
import { Markdown } from '../components/Markdown';

const TOOL_ICON: Record<string, string> = {
  Bash: 'terminal', PowerShell: 'terminal', Read: 'file', Write: 'file', Edit: 'pencil', Grep: 'search', Glob: 'search',
  WebFetch: 'globe', WebSearch: 'globe', Agent: 'agent', AskUserQuestion: 'chat', EnterPlanMode: 'list', ExitPlanMode: 'list', Skill: 'spark',
};

export function Transcript({ rt, onRewind, onFork }: { rt: SessionRuntime; onRewind: (userId: string) => void; onFork: (userId: string) => void }) {
  const wsId = useApp((s) => s.sessions.find((x) => x.id === rt.id)?.workspaceId ?? '');
  let userN = 0;
  return (
    <>
      {rt.items.map((it) => {
        if (it.kind === 'user') userN += 1;
        return <ItemView key={it.id} it={it} rt={rt} wsId={wsId} userN={userN} onRewind={onRewind} onFork={onFork} />;
      })}
    </>
  );
}

function ItemView({ it, rt, wsId, userN, onRewind, onFork }: { it: Item; rt: SessionRuntime; wsId: string; userN: number; onRewind: (id: string) => void; onFork: (id: string) => void }) {
  const t = useT();
  switch (it.kind) {
    case 'user':
      return (
        <div className={cx('umsg', (it.from || it.fromApp) && 'peer')}>
          {it.from ? <span className="avatar peer" title={t('来自其他会话的消息')}><Icon name="link" size={13} /></span>
            : it.fromApp ? <span className="avatar peer app" title={t('Code Agent 发给 Claude 的消息')}><Icon name="shield" size={13} /></span>
              : <span className="avatar">W</span>}
          {it.from && <div className="from">{it.from.kind === 'receipt' ? t('回执 · 来自') : t('来自会话')} <SessionLink r={it.from} /></div>}
          {it.fromApp && <div className="from">Code Agent · {it.fromApp}</div>}
          <div className="text">{linkify(it.text, wsId)}</div>
          {(it.attachments.length > 0 || !!it.refs?.length) && (
            <div className="atts">
              {it.refs?.map((r) => <span key={r.sessionId} className="chip"><Icon name="chat" size={12} /><SessionLink r={r} /></span>)}
              {it.attachments.map((a) => <Chip key={a.id} icon={a.kind === 'image' ? 'image' : a.kind === 'paste' ? 'copy' : 'file'}>{a.name} · {a.meta}</Chip>)}
            </div>
          )}
          {!rt.readOnly && (
            <div className="hover-actions">
              <Button size="sm" icon="rewind" title={t('把文件回退到这条消息之前')} onClick={() => onRewind(it.id)}>{t('回退文件')}</Button>
              <Button size="sm" icon="branch" title={t('新建一个会话，停在这条消息之前，并把这条消息放进输入框')} onClick={() => onFork(it.id)}>{t('从这里分叉')}</Button>
            </div>
          )}
          <span className="sr-only">#{userN}</span>
        </div>
      );
    case 'text':
      return (
        <div className="atext">
          <Markdown text={it.text} wsId={wsId} />
          {it.streaming && <span className="caret" />}
          {it.aborted && <span className="aborted-tag">{t('（已中断）')}</span>}
        </div>
      );
    case 'thinking':
      return <Thinking text={it.text} seconds={it.seconds} streaming={it.streaming} />;
    case 'tool':
      return <ToolCard tool={it} sid={rt.id} />;
    case 'toolgroup':
      return <ToolGroup label={it.label} tools={it.tools} />;
    case 'plan':
      return <PlanCard plan={it.plan} version={it.version} status={it.status} />;
    case 'footer':
      return (
        <div className="footer-line">
          {it.stopReason === 'interrupted'
            ? <><Icon name="stop" size={12} />{t('第 {n} 轮 · 已中断', { n: it.turn })}</>
            : <>{t('第 {n} 轮', { n: it.turn })} · {duration(it.seconds)} · {t('{n} 次工具调用', { n: it.toolCalls })} · {tokens(it.tokens)} tokens · {t('停止原因')} {it.stopReason}</>}
        </div>
      );
    case 'divider':
      return <div className="divider"><span>{it.label}</span></div>;
    case 'notice':
      return <Notice tone={it.tone} text={it.text} action={it.action} sid={rt.id} />;
    case 'banner':
      return <Banner kind={it.banner} id={it.id} resolved={it.resolved} sid={rt.id} detail={it.detail} />;
    case 'review':
      return <ReviewCard ticketId={it.ticketId} round={it.round} what={it.what} />;
    case 'board':
      return <BoardRecord it={it} sid={rt.id} wsId={wsId} />;
  }
}


/** Board changes from the recorder or Claude's board tools, with one-click undo. */
function BoardRecord({ it, sid, wsId }: { it: Extract<Item, { kind: 'board' }>; sid: string; wsId: string }) {
  const t = useT();
  const board = useApp((s) => s.board);
  return (
    <div className={cx('board-record', it.undone && 'undone')}>
      <div className="head">
        <Icon name="board" size={15} />
        <b>{it.by === 'recorder' ? t('已自动记到看板') : t('Claude 记到了看板')}</b>
        {it.model && <span className="muted">{t('后台识别 · {m}', { m: it.model })}</span>}
        <span className="grow" />
        {it.undone ? <span className="muted">{t('已撤销')}</span> : <button className="link-btn" onClick={() => api.undoBoardRecord(sid, it.id)}>{t('撤销')}</button>}
      </div>
      {it.changes.map((c) => {
        const item = board.find((x) => x.workspaceId === wsId && x.id === c.itemId);
        return (
          <div key={c.itemId} className="chg">
            <Chip tone={c.action === 'created' ? 'accent' : undefined}>{c.action === 'created' ? t('新建') : t('更新')}</Chip>
            <BoardLink id={c.itemId} wsId={wsId} />
            {item && <span className="title">{item.title}</span>}
            <span className="muted">{c.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function Thinking({ text, seconds, streaming }: { text: string; seconds: number; streaming?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <div className="thinking-head" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevDown' : 'chevRight'} size={14} />
        <Icon name="bulb" size={14} />
        <b>{streaming ? t('思考中…') : t('思考 · {s} 秒', { s: seconds })}</b>
        {!open && <span className="pv">{text}</span>}
      </div>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function StatusIcon({ status }: { status: ToolItem['status'] }) {
  if (status === 'running') return <span className="spinner" />;
  const map = { ok: ['check', 'st-ok'], error: ['x', 'st-error'], waiting: ['warning', 'st-waiting'], denied: ['x', 'st-denied'] } as const;
  const [icon, cls] = map[status];
  return <Icon name={icon} size={15} strokeWidth={2.2} className={cls} />;
}

/** A session named in the transcript; links to it while it exists, under its current title. */
export function SessionLink({ r }: { r: SessionRef }) {
  const t = useT();
  const nav = useNavigate();
  const title = useApp((s) => s.sessions.find((x) => x.id === r.sessionId)?.title);
  if (!title) return <span className="muted">「{r.title}」{t('（已删除）')}</span>;
  return (
    <a className="session-link" onClick={(e) => { e.stopPropagation(); api.openSession(r.sessionId); nav(`/s/${r.sessionId}`); }}>「{title}」</a>
  );
}

const PEER_INFO: Record<PeerCall['op'], { icon: string; label: string }> = {
  list: { icon: 'list', label: '列出会话' },
  read: { icon: 'chat', label: '读取会话' },
  status: { icon: 'eye', label: '查看会话状态' },
  send: { icon: 'send', label: '发消息给会话' },
  create: { icon: 'plus', label: '新建会话' },
};

const DELIVERY: Record<NonNullable<PeerCall['delivery']>, { label: string; tone?: 'accent' | 'warn' | 'crit' | 'good' }> = {
  delivered: { label: '已送达', tone: 'accent' },
  queued: { label: '对方正忙，已排队' },
  held: { label: '等你放行', tone: 'warn' },
  handled: { label: '对方已处理', tone: 'good' },
  rejected: { label: '你没有放行', tone: 'crit' },
};

/** Calls to the workspace tools: list, read, check, message and create sessions. */
function PeerCard({ tool }: { tool: ToolItem }) {
  const t = useT();
  const p = tool.peer!;
  const [open, setOpen] = useState(p.op === 'send' || p.op === 'create');
  const hasBody = !!p.message || !!p.rows?.length;
  const info = PEER_INFO[p.op];
  return (
    <div className="tcard peer">
      <div className="thead" onClick={() => hasBody && setOpen(!open)}>
        <Icon name={info.icon} size={15} className="ink2" />
        <span className="name">{t(info.label)}</span>
        <span className="detail plain">{p.target ? <SessionLink r={p.target} /> : tool.detail}</span>
        {p.worktree && <Chip icon="branch" mono title={t('新会话在自己的 git worktree 和分支里工作')}>{p.worktree}</Chip>}
        {p.delivery && <Chip tone={DELIVERY[p.delivery].tone}>{t(DELIVERY[p.delivery].label)}</Chip>}
        <StatusIcon status={tool.status} />
        {hasBody && <Icon name={open ? 'chevUp' : 'chevDown'} size={14} className="muted" />}
      </div>
      {open && hasBody && (
        <div className="tbody">
          {p.message && <div className="peer-quote">{p.message}</div>}
          {!!p.rows?.length && (
            <div className="nested">
              {p.rows.map((r, i) => (
                <div key={i} className="nested-row">
                  <Icon name={r.icon} size={14} className="ink2" />
                  <span className="t">{r.text}</span>
                  {r.right && <span className="muted">{r.right}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolCard({ tool, sid }: { tool: ToolItem; sid: string }) {
  if (tool.peer) return <PeerCard tool={tool} />;
  return <PlainToolCard tool={tool} sid={sid} />;
}

function PlainToolCard({ tool, sid }: { tool: ToolItem; sid: string }) {
  const t = useT();
  const wsId = useApp((s) => s.sessions.find((x) => x.id === sid)?.workspaceId ?? '');
  const canBackground = !!tool.backgroundable && tool.status === 'running' && !tool.background;
  const hasBody = !!tool.output || !!tool.agent || !!tool.denialMessage || canBackground || !!tool.background || !!tool.rows?.length;
  const [open, setOpen] = useState(tool.tool !== 'Read');
  const nav = useNavigate();
  return (
    <div className={cx('tcard', tool.status === 'waiting' && 'waiting', tool.status === 'denied' && 'denied')}>
      <div className="thead" onClick={() => hasBody && setOpen(!open)}>
        <Icon name={TOOL_ICON[tool.tool] ?? 'plug'} size={15} className="ink2" />
        <span className="name">{tool.tool.startsWith('mcp__') ? tool.tool.split('__').slice(1).join(' · ') : tool.tool}</span>
        <span className="detail" title={tool.detail}>{tool.detail}</span>
        {tool.background && <Chip tone="accent" icon="layers">{t('后台运行')}</Chip>}
        {tool.provenance && tool.status !== 'waiting' && <Chip icon="shield" title={t('这次调用为什么被执行 / 拒绝')}>{tool.provenance}</Chip>}
        {tool.right && <span className="right">{tool.right}</span>}
        <StatusIcon status={tool.status} />
        {hasBody && <Icon name={open ? 'chevUp' : 'chevDown'} size={14} className="muted" />}
      </div>
      {open && hasBody && (
        <div className="tbody">
          {tool.agent && (
            <>
              {tool.agent.summary && <div className="agent-summary"><Icon name="spark" size={13} />{tool.agent.summary}</div>}
              {tool.agent.rows.length > 0 && (
                <div className="nested">
                  {tool.agent.rows.map((r, i) => (
                    <div key={i} className="nested-row">
                      <Icon name={r.icon} size={14} className="ink2" />
                      <span className={cx('t', r.mono && 'mono')}>{r.text}</span>
                      {r.right && <span className="muted">{r.right}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="row">
                {tool.agent.tokens > 0 && <Chip>{tokens(tool.agent.tokens)} tokens</Chip>}
                {tool.agent.toolCalls > 0 && <Chip>{t('{n} 次工具调用', { n: tool.agent.toolCalls })}</Chip>}
                {tool.agent.background && <a style={{ cursor: 'pointer' }} onClick={() => useApp.getState().setInspector({ open: true, tab: 'background' })}>{t('在「后台」中查看 →')}</a>}
              </div>
            </>
          )}
          {tool.output?.type === 'diff' && (
            <div className="diff">
              {tool.output.lines.map((l, i) => <div key={i} className={l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l}</div>)}
            </div>
          )}
          {tool.output?.type === 'code' && <pre className="code-block">{tool.output.lines.join('\n')}</pre>}
          {tool.output?.type === 'text' && <div className="ink2">{tool.output.text}</div>}
          {!!tool.rows?.length && (
            <div className="nested">
              {tool.rows.map((r, i) => (
                <div key={i} className="nested-row">
                  <Icon name={r.icon} size={14} className="ink2" />
                  <span className={cx('t', r.mono && 'mono')}>{linkify(r.text, wsId)}</span>
                  {r.right && <span className="muted">{r.right}</span>}
                </div>
              ))}
            </div>
          )}
          {tool.denialMessage && <div className="denial">{t('你的说明：')}{tool.denialMessage}</div>}
          {canBackground && (
            <div className="actions">
              <Button size="sm" icon="layers" onClick={() => api.backgroundTool(sid, tool.id)}>{t('转入后台')}</Button>
              <span className="hint">{t('本轮继续，命令在后台运行，完成后通知你')}</span>
            </div>
          )}
          {tool.background && (
            <div className="actions">
              <Button size="sm" onClick={() => { useApp.getState().setInspector({ open: true, tab: 'background' }); nav(`/s/${sid}`); }}>{t('在「后台」中查看')}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolGroup({ label, tools }: { label: string; tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tgroup">
      <div className="tgroup-head" onClick={() => setOpen(!open)}>
        <Icon name="list" size={15} />
        <span className="grow">{label || '…'}</span>
        <Icon name={open ? 'chevUp' : 'chevRight'} size={14} className="muted" />
      </div>
      {open && (
        <div className="tgroup-body">
          {tools.map((x) => (
            <div key={x.id} className="tgroup-row">
              <Icon name={TOOL_ICON[x.tool] ?? 'plug'} size={13} className="ink2" />
              <b>{x.tool}</b>
              <span className="d">{x.detail}</span>
              {x.right && <span className="muted">{x.right}</span>}
              <Icon name="check" size={13} className="st-ok" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, version, status }: { plan: PlanDoc; version: number; status: 'pending' | 'approved' | 'revised' }) {
  const t = useT();
  const [open, setOpen] = useState(status !== 'revised');
  return (
    <div className={cx('plan-card', status)}>
      <div className="plan-head" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <Icon name="list" size={16} />
        <b>{t('计划')}</b>
        <Chip className="outline">v{version}</Chip>
        <span className="grow" />
        {status === 'pending' && <span>{t('等待你批准')}</span>}
        {status === 'approved' && <Chip tone="good" icon="check">{t('已批准')}</Chip>}
        {status === 'revised' && <Chip>{t('已退回修改')}</Chip>}
        <Icon name={open ? 'chevUp' : 'chevDown'} size={14} />
      </div>
      {open && plan.markdown && <div className="plan-body"><Markdown text={plan.markdown} /></div>}
      {open && !plan.markdown && (
        <div className="plan-body">
          <h3>{plan.title}</h3>
          <div className="ink2">{plan.summary}</div>
          <h4>{t('步骤')}</h4>
          <ol>{plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <h4>{t('文件')}</h4>
          <div className="plan-files">{plan.files.map((f) => <Chip key={f} mono icon="file">{f}</Chip>)}</div>
          <h4>{t('风险')}</h4>
          <ul>{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function Notice({ tone, text, action, sid }: { tone: 'good' | 'info' | 'warn'; text: string; action?: string; sid: string }) {
  const nav = useNavigate();
  return (
    <div className={cx('notice', tone)}>
      <Icon name={tone === 'good' ? 'check' : tone === 'warn' ? 'warning' : 'info'} size={15} />
      <span>{text}</span>
      {action && (
        <button className="link-btn" onClick={() => {
          if (action === '打开用量') nav('/usage');
          else if (action === '查看审核记录') useApp.getState().set({ reviewRecord: sid });
          else useApp.getState().setInspector({ open: true, tab: 'background' });
          void sid;
        }}>{action}</button>
      )}
    </div>
  );
}

const STARTUP: Record<string, string> = {
  cwd_unavailable: '工作目录已不存在或无法访问', shell_tool_missing: '找不到可用的 shell', cli_version_too_old: 'Claude Code 版本太旧',
  proxy_invalid: '代理设置无效', temp_dir_unusable: '临时目录不可用', managed_settings_invalid: '托管设置文件无效',
};

const BANNERS: Record<string, { tone: 'warn' | 'crit' | 'info'; icon: string; title: (d?: string) => string; d: (d?: string) => string; acts: string[] }> = {
  crash: { tone: 'crit', icon: 'x', title: () => '会话意外结束', d: (d) => `Claude Code 进程异常结束${d ? `：${d}` : ''}。对话记录已保存。`, acts: ['恢复会话', '查看 stderr'] },
  rateLimit: { tone: 'warn', icon: 'warning', title: () => '已达到用量限额', d: (d) => (d ? `${d} 重置。在那之前的请求会被拒绝。` : '在限额重置前，请求会被拒绝。'), acts: ['查看用量'] },
  startupFailure: { tone: 'crit', icon: 'x', title: () => '会话无法启动', d: (d) => `${(d && STARTUP[d]) || '启动失败'}${d ? `（${d}）` : ''}。`, acts: ['选择其他文件夹', '查看原文'] },
  workerShutdown: { tone: 'warn', icon: 'warning', title: () => 'Claude Code 正在退出', d: (d) => `原因：${d || '未说明'}。对话记录已保存。`, acts: ['恢复会话'] },
  denials: { tone: 'warn', icon: 'warning', title: (d) => `本轮有 ${d ?? '多'} 次工具调用被拒绝`, d: () => '被拒绝的调用在上面标出了原因。可以调整权限规则，或切换权限模式。', acts: ['查看权限规则'] },
  notLoggedIn: { tone: 'crit', icon: 'x', title: () => 'Claude Code 尚未登录', d: (d) => `请在你自己的终端运行 claude 并输入 /login，完成后点「重新检测」${d ? `（${d}）` : ''}。Code Agent 不提供登录，也不读取你的凭据。`, acts: ['复制登录命令', '重新检测'] },
};

function Banner({ kind, id, resolved, sid, detail }: { kind: string; id: string; resolved?: boolean; sid: string; detail?: string }) {
  const t = useT();
  const nav = useNavigate();
  const b = BANNERS[kind];
  const [showRaw, setShowRaw] = useState(false);
  if (!b) return null;
  const act = (a: string) => {
    if (a === '恢复会话') { api.resume(sid); api.retryBanner(sid, id); }
    else if (a === '查看 stderr') useApp.getState().setInspector({ open: true, tab: 'events', eventsSub: 'stderr' });
    else if (a === '查看用量') nav('/usage');
    else if (a === '选择其他文件夹') useApp.getState().set({ folderPickerOpen: true });
    else if (a === '查看原文') setShowRaw(!showRaw);
    else if (a === '查看权限规则') nav('/settings/permissions');
    else if (a === '复制登录命令') { void navigator.clipboard?.writeText('claude'); useApp.getState().toast(t('已复制：claude（在终端里运行后输入 /login）'), 'good'); }
    else if (a === '重新检测') {
      void api.checkLogin().then(() => {
        const p = useApp.getState().provider;
        useApp.getState().toast(p.loggedIn ? t('已检测到登录 · Claude {p}', { p: p.plan }) : t('仍未检测到登录，请先在终端完成 /login'), p.loggedIn ? 'good' : 'warn');
        if (p.loggedIn) api.retryBanner(sid, id);
      });
    }
  };
  return (
    <div className={cx('banner', b.tone, resolved && 'resolved')}>
      <Icon name={b.icon} size={18} strokeWidth={2} />
      <div className="body">
        <b>{t(b.title(detail))}</b>
        <div className="d">{t(b.d(detail))}</div>
        {showRaw && <pre className="code-block" style={{ marginTop: 8 }}>{JSON.stringify({ banner: kind, detail }, null, 2)}</pre>}
        {!resolved && <div className="acts">{b.acts.map((a, i) => <Button key={a} size="sm" variant={i === 0 && b.tone !== 'info' ? 'primary' : 'default'} onClick={() => act(a)}>{t(a)}</Button>)}</div>}
      </div>
    </div>
  );
}
