import { useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ConfirmHost, Popover, Select, Toasts, Toggle } from '../components/ui';
import { useApp } from '../store/app';
import { useSessions } from '../store/sessions';
import { useT } from '../lib/i18n';
import { relTime } from '../lib/format';
import { cx } from '../lib/util';
import { MockConsole } from './MockConsole';
import { FolderPicker } from './FolderPicker';
import { api } from '../api';

export function AppShell() {
  const t = useT();
  const connection = useApp((s) => s.connection);
  return (
    <div className="app">
      <TopBar />
      <nav className="navrail" aria-label={t('主导航')}>
        <NavLink to="/" end className={({ isActive }) => cx(isActive && 'active')}><Icon name="chat" size={22} />{t('会话')}</NavLink>
        <NavLink to="/usage" className={({ isActive }) => cx(isActive && 'active')}><Icon name="chart" size={22} />{t('用量')}</NavLink>
        <NavLink to="/settings" className={({ isActive }) => cx(isActive && 'active')}><Icon name="gear" size={22} />{t('设置')}</NavLink>
        <button className="bottom mock-btn" title={t('模拟控制台：触发场景和异常状态')} onClick={() => useApp.getState().set({ mockConsoleOpen: !useApp.getState().mockConsoleOpen })}>
          <Icon name="flask" size={22} />{t('模拟')}
        </button>
      </nav>
      <main className="main">
        {connection !== 'online' && (
          <div className={cx('conn-bar', connection)}>
            {connection === 'offline' ? <><span className="spinner" />{t('与 Code Agent 服务的连接已断开 —— 正在重连（第 3 次）… 会话仍在服务端运行。')}</>
              : <><Icon name="check" size={15} />{t('已重连 · 重放了 214 条事件，待处理的请求已重新出现。')}</>}
          </div>
        )}
        <Outlet />
      </main>
      <ConfirmHost />
      <Toasts />
      <MockConsole />
      <FolderPicker />
    </div>
  );
}

function TopBar() {
  const t = useT();
  const nav = useNavigate();
  const workspaces = useApp((s) => s.workspaces);
  const current = useApp((s) => s.currentWorkspaceId);
  const provider = useApp((s) => s.provider);
  const authKind = provider.kind === 'subscription' ? t('Claude 订阅') : provider.kind === 'apiKey' ? 'API Key' : provider.kind === 'compatible' ? t('兼容接口') : t('云厂商');
  return (
    <header className="topbar">
      <div className="brand" onClick={() => nav('/')}>
        <span className="logo"><Icon name="chevRight" size={16} strokeWidth={2.4} /></span>
        Code Agent<span className="by">{t('由 Claude 驱动')}</span>
      </div>
      {workspaces.length > 0 && (
        <Select
          className="ws-switch"
          icon="folder"
          value={current}
          width={300}
          options={[
            ...workspaces.map((w) => ({ value: w.id, label: w.path, icon: 'folder' })),
            { value: '__open', label: t('打开文件夹…'), icon: 'plus' },
          ]}
          renderValue={(o) => o?.label}
          onChange={(v) => {
            if (v === '__open') useApp.getState().set({ folderPickerOpen: true });
            else useApp.getState().set({ currentWorkspaceId: v });
          }}
        />
      )}
      <SearchBox />
      <div className="spacer" />
      <LanguageButton />
      <ApprovalsInbox />
      <div className="account" onClick={() => nav('/settings/provider')} title={t('模型服务与账号')}>
        <span className="avatar">W</span>
        <span className="lines">
          <span className="muted">{authKind}</span>
          <b>{provider.kind === 'subscription' ? (provider.loggedIn ? provider.plan : t('未登录')) : t('已配置')}</b>
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
      { label: t('用量'), to: '/usage' }, { label: t('设置 · 配置方案'), to: '/settings/profiles' }, { label: t('设置 · 权限规则与沙箱'), to: '/settings/permissions' },
      { label: t('设置 · 模型服务与账号'), to: '/settings/provider' }, { label: t('设置 · 语言与地区'), to: '/settings/language' }, { label: t('全部会话'), to: '/sessions' },
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
    { v: 'en', label: 'English', disabled: true, hint: t('交互定稿后补齐翻译') },
  ];
  return (
    <>
      <button ref={ref} className="lang-btn" onClick={() => setOpen(!open)} title={t('界面语言')}>
        <Icon name="globe" size={18} />{pref === 'en' ? 'EN' : '中'}
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
  const runtimes = useSessions((s) => s.runtimes);
  const sessions = useApp((s) => s.sessions);
  const notify = useApp((s) => s.prefs.browserNotifications);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const pending = Object.values(runtimes)
    .filter((r) => r.request)
    .map((r) => ({ rt: r, sum: sessions.find((s) => s.id === r.id) }))
    .filter((x) => x.sum)
    .sort((a, b) => a.rt.request!.since - b.rt.request!.since);
  return (
    <>
      <button ref={ref} className="top-icon" onClick={() => setOpen(!open)} title={t('等你处理')}>
        <Icon name="bell" size={20} />
        {pending.length > 0 && <span className="badge">{pending.length}</span>}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} placement="bottom-end" className="inbox">
        <h4>{t('等你处理')} {pending.length > 0 && <span className="chip crit">{pending.length}</span>}</h4>
        {pending.length === 0 && <div className="empty"><b>{t('没有待处理的请求')}</b>{t('审批、提问和计划审阅会出现在这里')}</div>}
        {pending.map(({ rt, sum }) => {
          const req = rt.request!;
          const what = req.kind === 'approval' ? `${req.tool} · ${req.command ?? req.diff?.path ?? ''}` : req.kind === 'question' ? t('Claude 有问题要问你') : t('计划待审阅');
          return (
            <div key={rt.id} className={cx('inbox-item', rt.id === currentId && 'current')} onClick={() => { setOpen(false); api.openSession(rt.id); nav(`/s/${rt.id}`); }}>
              <Icon name={req.kind === 'approval' ? 'shield' : req.kind === 'question' ? 'chat' : 'list'} size={16} className="ink2" />
              <div className="grow">
                <div className="t ellipsis">{sum!.title}</div>
                <div className="d ellipsis">{what}</div>
                <div className="w">{rt.id === currentId ? t('正在查看') : t('已等待 {t}', { t: relTime(req.since).replace('刚刚', '不到 1 分钟') })}</div>
              </div>
            </div>
          );
        })}
        <div className="foot">
          <Toggle on={notify} onChange={(v) => useApp.getState().setPrefs({ browserNotifications: v })} label={t('等待时发送浏览器通知')} />
        </div>
      </Popover>
    </>
  );
}

