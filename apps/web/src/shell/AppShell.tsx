import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Button, ConfirmHost, Popover, Select, Toasts, Toggle, UserAvatar } from '../components/ui';
import { useApp } from '../store/app';
import { resolveLocale, useT } from '../lib/i18n';
import { relTime } from '../lib/format';
import { cx } from '../lib/util';
import { CLOSED } from '../lib/board';
import { FolderPicker } from './FolderPicker';
import { api } from '../api';
import { useGoToSessions, useOpenWorkspace } from '../components/SessionRow';
import { requestNotificationPermission } from '../lib/notify';

export function AppShell() {
  const t = useT();
  const connection = useApp((s) => s.connection);
  const attempt = useApp((s) => s.reconnectAttempt);
  const booted = useApp((s) => s.booted);
  const goToSessions = useGoToSessions();
  const atHome = useMatch('/');
  const atSession = useMatch('/s/:id');
  const atList = useMatch('/sessions');
  const onSessions = !!(atHome || atSession || atList);
  return (
    <div className="app">
      <TopBar />
      <nav className="navrail" aria-label={t('主导航')}>
        <button className={cx(onSessions && 'active')} onClick={goToSessions} title={t('进入所选工作区上次打开的会话；选择「所有工作区」时进入总览')}><Icon name="chat" size={22} />{t('会话')}</button>
        <BoardNav />
        <NavLink to="/mcp" className={({ isActive }) => cx(isActive && 'active')}><Icon name="plug" size={22} />MCP</NavLink>
        <NavLink to="/skills" className={({ isActive }) => cx(isActive && 'active')}><Icon name="spark" size={22} />{t('技能')}</NavLink>
        <NavLink to="/hooks" className={({ isActive }) => cx(isActive && 'active')}><Icon name="hook" size={22} />{t('钩子')}</NavLink>
        <NavLink to="/jobs" className={({ isActive }) => cx(isActive && 'active')}><Icon name="braces" size={22} />{t('作业')}</NavLink>
        <NavLink to="/usage" className={({ isActive }) => cx(isActive && 'active')}><Icon name="chart" size={22} />{t('用量')}</NavLink>
        <NavLink to="/settings" className={({ isActive }) => cx(isActive && 'active')}><Icon name="gear" size={22} />{t('设置')}</NavLink>
      </nav>
      <main className="main">
        {connection !== 'online' && (
          <div className={cx('conn-bar', connection)}>
            {connection === 'offline' ? <><span className="spinner" />{t('与 Code Agent 服务的连接已断开 —— 正在重连（第 {n} 次）… 会话仍在服务端运行。', { n: attempt })}</>
              : <><Icon name="check" size={15} />{t('已重连 · 已重新载入会话状态，待处理的请求已重新出现。')}</>}
          </div>
        )}
        {booted ? <Outlet /> : <div className="boot"><span className="spinner" />{t('正在连接 Code Agent 服务…')}</div>}
      </main>
      <TopProgress />
      <ConfirmHost />
      <Toasts />
      <FolderPicker />
    </div>
  );
}

/** A thin bar at the top while a server call the user waits for takes longer than 300 ms. */
function TopProgress() {
  const t = useT();
  const busy = useApp((s) => s.busy > 0);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!busy) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), 300);
    return () => clearTimeout(timer);
  }, [busy]);
  return shown ? <div className="top-progress" role="progressbar" aria-label={t('正在处理')} /> : null;
}

/** 看板 in the left rail, with the selected workspace's count of unfinished features and issues (notes left out). */
function BoardNav() {
  const t = useT();
  const ws = useApp((s) => s.currentWorkspaceId);
  const n = useApp((s) => s.board.filter((x) => x.kind !== 'note' && !CLOSED.includes(x.status) && (!ws || x.workspaceId === ws)).length);
  return (
    <NavLink to={ws ? `/board?ws=${ws}` : '/board'} className={({ isActive }) => cx('nav-badged', isActive && 'active')} title={n ? t('{n} 个未完成的功能和问题', { n }) : undefined}>
      <Icon name="board" size={22} />{t('看板')}
      {n > 0 && <span className="nbadge">{n}</span>}
    </NavLink>
  );
}

function TopBar() {
  const t = useT();
  const nav = useNavigate();
  const workspaces = useApp((s) => s.workspaces);
  const current = useApp((s) => s.currentWorkspaceId);
  const provider = useApp((s) => s.provider);
  const openWorkspace = useOpenWorkspace();
  const goToSessions = useGoToSessions();
  const endpoints = provider.endpoints.filter((e) => e.models.length).length;
  const [authKind, authState] = provider.loggedIn
    ? [t('Claude 订阅'), endpoints ? t('{p} + {n} 个端点', { p: provider.plan, n: endpoints }) : provider.plan]
    : endpoints ? [t('兼容端点'), t('{n} 个端点', { n: endpoints })] : [t('模型服务'), t('未配置')];
  return (
    <header className="topbar">
      <div className="brand" onClick={goToSessions}>
        <span className="logo"><Icon name="chevRight" size={16} strokeWidth={2.4} /></span>
        Code Agent<span className="by">{t('由 Claude 驱动')}</span>
      </div>
      {workspaces.length > 0 && (
        <Select
          className="ws-switch"
          icon="folder"
          value={current || '__all'}
          width={320}
          options={[
            ...workspaces.map((w) => ({ value: w.id, label: w.path, icon: 'folder' })),
            { value: '__all', label: t('所有工作区'), desc: t('工作区与最近会话总览'), icon: 'home', dividerBefore: true },
            { value: '__open', label: t('打开文件夹…'), icon: 'plus' },
          ]}
          renderValue={(o) => o?.label}
          onChange={(v) => {
            if (v === '__open') useApp.getState().set({ folderPickerOpen: true });
            else if (v === '__all') { useApp.getState().set({ currentWorkspaceId: '' }); nav('/'); }
            else openWorkspace(v);
          }}
        />
      )}
      <SearchBox />
      <div className="spacer" />
      <LanguageButton />
      <ApprovalsInbox />
      <div className="account" onClick={() => nav('/settings/provider')} title={t('模型服务与账号')}>
        <UserAvatar />
        <span className="lines">
          <span className="muted">{authKind}</span>
          <b>{authState}</b>
        </span>
      </div>
    </header>
  );
}

function SearchBox() {
  const t = useT();
  const nav = useNavigate();
  const sessions = useApp((s) => s.sessions);
  const workspaces = useApp((s) => s.workspaces);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return [];
    const pages = [
      { label: t('看板'), to: '/board' }, { label: t('用量'), to: '/usage' }, { label: t('设置 · 配置方案'), to: '/settings/profiles' }, { label: t('设置 · 权限规则'), to: '/settings/permissions' },
      { label: t('MCP 服务器'), to: '/mcp' }, { label: t('技能、命令与插件'), to: '/skills' }, { label: t('钩子'), to: '/hooks' }, { label: t('作业'), to: '/jobs' },
      { label: t('设置 · 常规（同时运行的会话、通知）'), to: '/settings/general' }, { label: t('设置 · 会话协作'), to: '/settings/collaboration' }, { label: t('设置 · 模型服务与账号'), to: '/settings/provider' }, { label: t('设置 · 语言与地区'), to: '/settings/language' }, { label: t('全部会话'), to: '/sessions' },
    ].filter((p) => p.label.toLowerCase().includes(k));
    const ss = sessions.filter((s) => !s.draft && (s.title.toLowerCase().includes(k) || s.firstPrompt.toLowerCase().includes(k))).slice(0, 6);
    return [...ss.map((s) => ({ label: s.title, sub: `${workspaces.find((w) => w.id === s.workspaceId)?.name ?? ''} · ${relTime(s.lastActive)}`, to: `/s/${s.id}`, icon: 'chat' })), ...pages.map((p) => ({ ...p, sub: t('页面'), icon: 'chevRight' }))];
  }, [q, sessions, workspaces, t]);
  return (
    <div className="top-search" ref={ref}>
      <div className="input-wrap">
        <Icon name="search" size={15} />
        <input className="input" placeholder={t('搜索会话、设置…')} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      </div>
      <Popover anchor={ref.current} open={open && q.trim().length > 0} onClose={() => setOpen(false)} width={340}>
        {results.length === 0 && <div className="empty">{t('没有匹配的结果')}</div>}
        {results.map((r, i) => (
          <button key={i} className="menu-item" onClick={() => { setOpen(false); setQ(''); nav(r.to); }}>
            <Icon name={r.icon} size={15} />
            <span className="grow">{r.label}<span className="desc">{r.sub}</span></span>
          </button>
        ))}
      </Popover>
    </div>
  );
}

function LanguageButton() {
  const t = useT();
  const pref = useApp((s) => s.prefs.uiLanguage);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const opts: Array<{ v: 'auto' | 'zh-CN' | 'en'; label: string; disabled?: boolean; hint?: string }> = [
    { v: 'auto', label: t('跟随浏览器') },
    { v: 'zh-CN', label: '简体中文' },
    { v: 'en', label: 'English' },
  ];
  return (
    <>
      <button ref={ref} className="lang-btn" onClick={() => setOpen(!open)} title={t('界面语言')}>
        <Icon name="globe" size={18} />{resolveLocale(pref) === 'en' ? 'EN' : '中'}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} placement="bottom-end" width={220}>
        {opts.map((o) => (
          <button key={o.v} className={cx('menu-item', pref === o.v && 'on')} disabled={o.disabled} onClick={() => { useApp.getState().setPrefs({ uiLanguage: o.v }); setOpen(false); }}>
            <span className="grow">{o.label}{o.hint && <span className="desc">{o.hint}</span>}</span>
            {pref === o.v && <Icon name="check" size={14} />}
          </button>
        ))}
      </Popover>
    </>
  );
}

function ApprovalsInbox() {
  const t = useT();
  const nav = useNavigate();
  const currentId = useMatch('/s/:id')?.params.id;
  const sessions = useApp((s) => s.sessions);
  const held = useApp((s) => s.held);
  const allReviews = useApp((s) => s.reviews);
  const decisions = allReviews.filter((r) => r.status === 'needs_decision' || r.status === 'checks_failed');
  const maxHops = useApp((s) => s.peer.maxHops);
  const notify = useApp((s) => s.prefs.browserNotifications);
  const open = useApp((s) => s.inboxOpen);
  const setOpen = (v: boolean) => useApp.getState().set({ inboxOpen: v });
  const ref = useRef<HTMLButtonElement>(null);
  // Every session's waiting requests come with the session list, opened here or not.
  const pending = sessions
    .filter((s) => s.requests?.length)
    .sort((a, b) => a.requests![0].since - b.requests![0].since);
  const count = pending.reduce((n, s) => n + s.requests!.length, 0) + held.length + decisions.length;
  useEffect(() => {
    document.title = count > 0 ? `(${count}) Code Agent` : 'Code Agent';
  }, [count]);
  return (
    <>
      <button ref={ref} className="top-icon" onClick={() => setOpen(!open)} title={t('等你处理')}>
        <Icon name="bell" size={20} />
        {count > 0 && <span className="badge">{count}</span>}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} placement="bottom-end" className="inbox">
        <h4>{t('等你处理')} {count > 0 && <span className="chip crit">{count}</span>}</h4>
        {count === 0 && <div className="empty"><b>{t('没有待处理的请求')}</b>{t('审批、提问、计划审阅、待放行的会话消息和要你决定的代码审核会出现在这里')}</div>}
        {pending.map((sum) => {
          const [req, ...rest] = sum.requests!;
          return (
            <div key={sum.id} className={cx('inbox-item', sum.id === currentId && 'current')} onClick={() => { setOpen(false); api.openSession(sum.id); nav(`/s/${sum.id}`); }}>
              <Icon name={{ approval: 'shield', question: 'chat', elicitation: 'plug', plan: 'list' }[req.kind]} size={16} className="ink2" />
              <div className="grow">
                <div className="t ellipsis">{sum.title}</div>
                <div className="d ellipsis">{t(req.title)}{req.detail ? ` · ${req.detail}` : ''}</div>
                {rest.length > 0 && <div className="d">{t('后面还有 {n} 个请求', { n: rest.length })}</div>}
                <div className="w">{sum.id === currentId ? t('正在查看') : t('已等待 {t}', { t: relTime(req.since).replace('刚刚', '不到 1 分钟') })}</div>
              </div>
            </div>
          );
        })}
        {decisions.map((r) => {
          const s = sessions.find((x) => x.id === r.sessionId);
          return (
            <div key={r.id} className={cx('inbox-item', r.sessionId === currentId && 'current')} onClick={() => { setOpen(false); api.openSession(r.sessionId); nav(`/s/${r.sessionId}`); }}>
              <Icon name="shield" size={16} className="ink2" />
              <div className="grow">
                <div className="t ellipsis">{s?.title}</div>
                <div className="d ellipsis">{r.status === 'needs_decision' ? t('代码审核 {n} 轮后仍未通过', { n: r.maxRounds }) : t('代码审核：验证连续 3 次没有通过')}</div>
                <div className="w">{t('等你决定')}</div>
              </div>
            </div>
          );
        })}
        {held.length > 0 && <h5 className="inbox-sec">{t('等你放行的会话消息')}</h5>}
        {held.map((h) => (
          <div key={h.id} className="inbox-item held">
            <Icon name="link" size={16} className="ink2" />
            <div className="grow">
              <div className="t ellipsis">{h.from.title}</div>
              <div className="to ellipsis">{t('发给「{x}」', { x: h.to.title })}</div>
              <div className="msg">{h.text}</div>
              <div className="w">{h.reason === 'mode' ? t('双方权限模式不同：一方跳过权限检查，另一方没有') : h.reason === 'hops' ? t('这串会话消息已连续转发超过 {n} 次，中间没有你的消息', { n: maxHops }) : t('设置为「总是先等我放行」')}</div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <Button size="sm" variant="primary" onClick={() => api.releaseHeld(h.id)}>{t('放行')}</Button>
                <Button size="sm" onClick={() => api.rejectHeld(h.id)}>{t('不放行')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setOpen(false); api.openSession(h.from.sessionId); nav(`/s/${h.from.sessionId}`); }}>{t('看发送方')}</Button>
              </div>
            </div>
          </div>
        ))}
        <div className="foot">
          <Toggle on={notify} onChange={(v) => { useApp.getState().setPrefs({ browserNotifications: v }); if (v) void requestNotificationPermission(); }} label={t('系统通知')} />
          <button className="link-btn" onClick={() => { setOpen(false); nav('/settings/general'); }}>{t('提醒设置 →')}</button>
        </div>
      </Popover>
    </>
  );
}

