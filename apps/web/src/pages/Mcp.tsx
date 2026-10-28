/**
 * P13 — MCP servers, from every source Claude Code reads: all workspaces (~/.claude.json),
 * one workspace on this machine (local scope), the repository's .mcp.json and plugins.
 */
import { useState } from 'react';
import type { McpServer, PermissionRule } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, Chip, Field, Modal, Seg, Select, Status, Toggle } from '../components/ui';
import { useApp } from '../store/app';
import { api } from '../api';
import { tokens as fmtTokens } from '../lib/format';
import { cx, uid } from '../lib/util';
import { useT } from '../lib/i18n';

const STATUS: Record<McpServer['status'], { tone: 'good' | 'warn' | 'crit' | 'info' | 'idle'; label: string }> = {
  connected: { tone: 'good', label: '已连接' },
  pending: { tone: 'info', label: '连接中' },
  failed: { tone: 'crit', label: '失败' },
  'needs-auth': { tone: 'warn', label: '需要登录' },
  disabled: { tone: 'idle', label: '已停用' },
};

const ANN_LABEL = { readOnly: '只读', destructive: '破坏性', openWorld: '访问外部' } as const;

/** Servers that apply to a workspace: global, its local and repository ones, and plugin ones. */
export function serversFor(all: McpServer[], wsId: string) {
  return all.filter((s) => s.scope === 'global' || s.scope === 'plugin' || s.workspaceId === wsId);
}

export function Mcp() {
  const t = useT();
  const app = useApp();
  const [wsId, setWsId] = useState(app.currentWorkspaceId || app.workspaces[0]?.id || '');
  const ws = app.workspaces.find((w) => w.id === wsId);
  const list = serversFor(app.mcp, wsId);
  const [selId, setSelId] = useState(list[0]?.id ?? '');
  const sel = list.find((s) => s.id === selId) ?? list[0];
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);

  const groups: Array<{ title: string; hint?: string; items: McpServer[] }> = [
    { title: t('所有工作区'), hint: '~/.claude.json', items: list.filter((s) => s.scope === 'global') },
    { title: t('这个工作区 · 仅本机'), items: list.filter((s) => s.scope === 'workspace') },
    { title: t('仓库 .mcp.json · 只读'), items: list.filter((s) => s.scope === 'repo') },
    ...Array.from(new Set(list.filter((s) => s.scope === 'plugin').map((s) => s.plugin))).map((p) => ({
      title: t('插件 {p} · 只读', { p: p ?? '' }), items: list.filter((s) => s.plugin === p),
    })),
  ];

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title"><h1>{t('MCP 服务器')}</h1></div>
        <p className="page-sub">{t('MCP 服务器给 Claude 提供额外的工具（GitHub、数据库、浏览器…）。配置保存在 Claude Code 自己的配置里，在终端里用 claude 时同样可用。')}</p>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="ink2">{t('查看工作区')}</span>
          <Select value={wsId} onChange={(v) => { setWsId(v); setSelId(''); }} icon="folder" className="w-240" options={app.workspaces.map((w) => ({ value: w.id, label: w.name, desc: w.path }))} />
          <span className="grow" />
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>{t('添加服务器')}</Button>
        </div>

        <div className="ext-layout">
          <div className="ext-list">
            {groups.filter((g) => g.items.length).map((g) => (
              <div key={g.title}>
                <h5>{g.title}{g.hint && <span className="mono" style={{ fontWeight: 400 }}>{g.hint}</span>}</h5>
                {g.items.map((s) => (
                  <div key={s.id} className={cx('ext-item', s.id === sel?.id && 'on')} onClick={() => setSelId(s.id)}>
                    <div className="top"><b>{s.name}</b><Chip>{s.type}</Chip><span className="grow" /><Status tone={STATUS[s.status].tone}>{t(STATUS[s.status].label)}</Status></div>
                    {s.status === 'failed' ? <div className="sub err">{s.error}</div>
                      : <div className="sub">{s.tools.length ? t('{n} 个工具', { n: s.tools.length }) : '—'}{s.prompts.length > 0 && <span>{t('{n} 个提示', { n: s.prompts.length })}</span>}</div>}
                  </div>
                ))}
              </div>
            ))}
            {list.length === 0 && <div className="empty">{t('这个工作区还没有 MCP 服务器')}</div>}
          </div>

          {sel ? <ServerDetail s={sel} wsId={wsId} wsName={ws?.name ?? ''} onEdit={() => setEditing(sel)} onRemoved={() => setSelId('')} /> : <div />}
        </div>

        <Behavior />
        {editing && <ServerForm server={editing === 'new' ? null : editing} wsId={wsId} wsName={ws?.name ?? ''} onClose={(id) => { setEditing(null); if (id) setSelId(id); }} />}
      </div>
    </div>
  );
}

function ServerDetail({ s, wsId, wsName, onEdit, onRemoved }: { s: McpServer; wsId: string; wsName: string; onEdit: () => void; onRemoved: () => void }) {
  const t = useT();
  const app = useApp();
  const [token, setToken] = useState('');
  const editable = s.scope === 'global' || s.scope === 'workspace';
  const patch = (p: Partial<McpServer>) => app.set({ mcp: useApp.getState().mcp.map((x) => (x.id === s.id ? { ...x, ...p } : x)) });
  const [busy, setBusy] = useState(false);
  const reconnect = async () => {
    setBusy(true);
    try {
      await api.testMcp(s.id);
      const now = useApp.getState().mcp.find((x) => x.name === s.name && x.scope === s.scope);
      app.toast(now?.status === 'connected' ? t('{n} 已连接', { n: s.name }) : t('{n} 仍然无法连接', { n: s.name }), now?.status === 'connected' ? 'good' : 'warn');
    } finally {
      setBusy(false);
    }
  };
  const live = app.sessions.filter((x) => x.live && !x.draft && (s.scope === 'global' || s.scope === 'plugin' || x.workspaceId === s.workspaceId));
  const sourceText = { global: t('所有工作区 · ~/.claude.json'), workspace: t('{w} · 仅本机', { w: wsName }), repo: t('{w} · 仓库 .mcp.json', { w: wsName }), plugin: t('插件 {p}', { p: s.plugin ?? '' }) }[s.scope];

  return (
    <div className="ext-detail">
      <div className="ext-head">
        <h2>{s.name}</h2>
        <Chip>{s.type}</Chip>
        <Status tone={STATUS[s.status].tone}>{t(STATUS[s.status].label)}{s.version ? ` · ${s.version}` : ''}</Status>
        <span className="grow" />
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => void reconnect()}>{busy ? t('连接中…') : t('重新连接')}</Button>
        {editable && <Button size="sm" icon="pencil" onClick={onEdit}>{t('编辑')}</Button>}
        {editable && (
          <Button size="sm" icon="trash" variant="danger-outline" onClick={() => app.ask({
            title: t('移除 {n}？', { n: s.name }), body: t('从配置中移除这个服务器。运行中的会话会断开它，Claude 不能再用它的工具。'), confirmLabel: t('移除'), danger: true,
            onConfirm: () => { app.set({ mcp: app.mcp.filter((x) => x.id !== s.id) }); onRemoved(); },
          })}>{t('移除')}</Button>
        )}
      </div>

      {s.status === 'failed' && <div className="banner-warn"><Icon name="warning" size={16} /><div><b>{t('启动失败')}</b><div className="mono">{s.error}</div></div></div>}
      {s.status === 'needs-auth' && (
        <div className="banner-warn">
          <Icon name="key" size={16} />
          <div className="grow">
            <b>{t('这个服务器需要登录')}</b>
            <div>{t('可以在对话中按服务器的提示在浏览器里完成登录（信息征询），或者直接粘贴访问令牌，作为请求头 Authorization 发送。')}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <input className="input sm mono grow" type="password" placeholder={t('访问令牌')} value={token} onChange={(e) => setToken(e.target.value)} />
              <Button size="sm" variant="primary" disabled={!token || busy} onClick={() => {
                setBusy(true);
                void api.setMcpHeader(s.id, s.type === 'stdio' ? 'TOKEN' : 'Authorization', s.type === 'stdio' ? token : `Bearer ${token}`).finally(() => { setBusy(false); setToken(''); });
              }}>{t('保存并连接')}</Button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
        <div className="panel">
          <div className="panel-head"><h3>{t('连接')}</h3></div>
          <div className="panel-body">
            <dl className="kv">
              <dt>{t('来源')}</dt><dd>{sourceText}</dd>
              {s.type === 'stdio' ? (
                <>
                  <dt>{t('命令')}</dt><dd className="mono">{[s.command, ...(s.args ?? [])].join(' ')}</dd>
                  {(s.env?.length ?? 0) > 0 && <><dt>{t('环境变量')}</dt><dd className="mono">{s.env!.map((e) => `${e.key}=${e.value}`).join('  ')}</dd></>}
                </>
              ) : (
                <>
                  <dt>URL</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{s.url}</dd>
                  <dt>{t('请求头')}</dt><dd className="mono">{s.headers?.length ? s.headers.map((h) => `${h.key}: ${h.value}`).join('; ') : '—'}</dd>
                </>
              )}
              <dt>{t('工具超时')}</dt><dd>{t('{n} 秒', { n: s.timeout })}</dd>
              <dt>{t('服务器说明')}</dt><dd>{s.instructionsTokens ? `${fmtTokens(s.instructionsTokens)} tokens` : '—'}</dd>
            </dl>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>{t('运行中的会话')}</h3><span className="sub">{t('只影响这个会话，不改配置')}</span></div>
          <div className="panel-body col">
            {live.length === 0 && <div className="muted">{t('没有用到它的运行中会话')}</div>}
            {live.map((x) => {
              const on = !s.offIn.includes(x.id);
              return (
                <div key={x.id} className="row">
                  <Toggle on={on} onChange={(v) => patch({ offIn: v ? s.offIn.filter((i) => i !== x.id) : [...s.offIn, x.id] })} />
                  <span className={cx('grow truncate', !on && 'muted')}>{x.title}</span>
                  <Button size="sm" variant="ghost" icon="refresh" title={t('在这个会话里重新连接')} disabled={!on} onClick={() => void api.reconnectMcpInSession(x.id, s.name).then(() => app.toast(t('已在「{n}」中重新连接 {s}', { n: x.title, s: s.name }), 'good'))} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ToolTable s={s} wsId={wsId} />

      {s.prompts.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h3>{t('提示')}</h3><span className="sub">{t('服务器提供的提示词模板，可以在对话里用 / 命令调用')}</span></div>
          <div className="panel-body col">
            {s.prompts.map((p) => <div key={p.name} className="row"><span className="mono">/mcp__{s.name}__{p.name}</span><span className="muted">{p.desc}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

type Approval = 'allow' | 'ask' | 'deny' | 'default';

/** Per-tool approval writes a permission rule `mcp__<server>__<tool>` in the server's scope. */
function ToolTable({ s, wsId }: { s: McpServer; wsId: string }) {
  const t = useT();
  const app = useApp();
  const ruleScope: Pick<PermissionRule, 'scope' | 'workspaceId'> = s.scope === 'workspace' || s.scope === 'repo' ? { scope: 'workspace', workspaceId: s.workspaceId ?? wsId } : { scope: 'global' };
  const same = (r: PermissionRule, name: string) => r.rule === name && r.scope === ruleScope.scope && (r.scope === 'global' || r.workspaceId === ruleScope.workspaceId);
  const get = (tool: string): Approval => {
    const name = `mcp__${s.name}__${tool}`;
    return app.rules.find((r) => same(r, name))?.behavior ?? 'default';
  };
  const setApproval = (tool: string, v: Approval) => {
    const name = `mcp__${s.name}__${tool}`;
    const rest = app.rules.filter((r) => !same(r, name));
    app.set({ rules: v === 'default' ? rest : [...rest, { id: uid('r'), behavior: v, rule: name, ...ruleScope }] });
  };
  const total = s.tools.reduce((a, x) => a + x.tokens, 0);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t('工具')}</h3>
        <span className="sub">{!s.tools.length ? '' : total ? t('{n} 个 · 定义共约 {k} tokens', { n: s.tools.length, k: fmtTokens(total) }) : t('{n} 个', { n: s.tools.length })}</span>
      </div>
      {s.tools.length === 0 ? <div className="empty">{t('连接成功后会列出它的工具')}</div> : (
        <div className="panel-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th style={{ paddingLeft: 16 }}>{t('工具')}</th><th>{t('特性')}</th><th className="num">tokens</th><th style={{ width: 250 }}>{t('审批')}</th></tr></thead>
            <tbody>
              {s.tools.map((x) => (
                <tr key={x.name}>
                  <td style={{ paddingLeft: 16 }}><div className="mono">{x.name}</div><div className="muted" style={{ fontSize: 11.5 }}>{x.desc}</div></td>
                  <td>{x.annotations.map((a) => <span key={a} className={cx('ann', a === 'destructive' && 'destructive')}>{t(ANN_LABEL[a])}</span>)}</td>
                  <td className="num">{x.tokens ? fmtTokens(x.tokens) : '—'}</td>
                  <td><Seg value={get(x.name)} onChange={(v) => setApproval(x.name, v)} items={[
                    { value: 'allow', label: t('允许') }, { value: 'ask', label: t('询问') }, { value: 'deny', label: t('拒绝') }, { value: 'default', label: t('默认') },
                  ]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint" style={{ padding: '8px 16px' }}>
            {t('审批设置会写进「权限规则」（{scope}），规则名形如 mcp__{n}__工具名。「默认」表示没有规则，按权限模式处理。', { scope: ruleScope.scope === 'global' ? t('所有工作区') : t('这个工作区'), n: s.name })}
          </div>
        </div>
      )}
    </div>
  );
}

function Behavior() {
  const t = useT();
  const app = useApp();
  const b = app.mcpBehavior;
  const set = (p: Partial<typeof b>) => app.set({ mcpBehavior: { ...b, ...p } });
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h3>{t('会话行为')}</h3><span className="sub">{t('对所有服务器生效')}</span></div>
      <div className="panel-body col">
        <Toggle on={b.strict} onChange={(v) => set({ strict: v })} label={t('只用这里登记的服务器')} hint={t('忽略仓库 .mcp.json 和插件里的服务器')} />
        <Toggle on={b.claudeAiConnectors !== false} onChange={(v) => set({ claudeAiConnectors: v })} label={t('加载 claude.ai 账号里的连接器')}
          hint={t('使用 Claude 订阅登录时，Claude Code 会自动加载你在 claude.ai 上连接的服务（如 Claude Docs）。关掉后只对 Code Agent 启动的会话生效')} />
        <div className="row">
          <span style={{ width: 70 }}>{t('工具搜索')}</span>
          <Select value={b.toolSearch} onChange={(v) => set({ toolSearch: v })} width={340} className="w-240" options={[
            { value: 'auto', label: t('自动'), desc: t('工具定义超过上下文的 10% 时按需加载') },
            { value: 'on', label: t('开启'), desc: t('总是按需加载工具定义') },
            { value: 'off', label: t('关闭'), desc: t('一开始就加载全部工具定义') },
          ]} />
          <span className="hint">{t('按需加载依赖模型服务支持；兼容端点不支持时会一次加载全部，占用更多上下文')}</span>
        </div>
        <div className="row">
          <span style={{ width: 70 }}>{t('首轮等待')}</span>
          <input className="input sm" style={{ width: 80 }} inputMode="numeric" value={b.firstTurnWait} onChange={(e) => set({ firstTurnWait: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          <span className="hint">{t('秒 · 会话第一轮前最多等服务器连接这么久')}</span>
        </div>
      </div>
    </div>
  );
}

function ServerForm({ server, wsId, wsName, onClose }: { server: McpServer | null; wsId: string; wsName: string; onClose: (id?: string) => void }) {
  const t = useT();
  const app = useApp();
  const [name, setName] = useState(server?.name ?? '');
  const [type, setType] = useState<McpServer['type']>(server?.type ?? 'stdio');
  const [command, setCommand] = useState(server ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ') : '');
  const [env, setEnv] = useState((server?.env ?? []).map((e) => `${e.key}=${e.value}`).join('\n'));
  const [url, setUrl] = useState(server?.url ?? '');
  const [headers, setHeaders] = useState((server?.headers ?? []).map((h) => `${h.key}: ${h.value}`).join('\n'));
  const [timeout, setTimeoutS] = useState(String(server?.timeout ?? 60));
  const [scope, setScope] = useState<'global' | 'workspace'>(server?.scope === 'workspace' ? 'workspace' : 'global');
  const nameOk = /^[A-Za-z0-9_-]+$/.test(name) && !app.mcp.some((x) => x.name === name && x.id !== server?.id && (x.scope === 'global' || x.workspaceId === wsId));
  const valid = nameOk && (type === 'stdio' ? !!command.trim() : /^https?:\/\//.test(url.trim()));

  const save = () => {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const data: McpServer = {
      id: scope === 'global' ? `global::${name}` : `workspace:${wsId}:${name}`, name, type, scope, workspaceId: scope === 'workspace' ? wsId : undefined,
      command: type === 'stdio' ? cmd : undefined, args: type === 'stdio' ? args : undefined,
      env: env.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ key: l.split('=')[0], value: l.slice(l.indexOf('=') + 1) })),
      url: type === 'stdio' ? undefined : url.trim(),
      headers: headers.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ key: l.split(':')[0].trim(), value: l.slice(l.indexOf(':') + 1).trim() })),
      timeout: Number(timeout) || 60, status: 'pending', instructionsTokens: server?.instructionsTokens ?? 0,
      tools: server?.tools ?? [], prompts: server?.prompts ?? [], offIn: server?.offIn ?? [],
    };
    // The server writes Claude Code's config, then connects to the server to list its tools.
    app.set({ mcp: server ? app.mcp.map((x) => (x.id === server.id ? data : x)) : [...app.mcp, data] });
    onClose(data.id);
  };

  return (
    <Modal title={server ? t('编辑 {n}', { n: server.name }) : t('添加 MCP 服务器')} width={620} onClose={() => onClose()}
      footer={<><Button onClick={() => onClose()}>{t('取消')}</Button><Button variant="primary" disabled={!valid} onClick={save}>{server ? t('保存') : t('添加')}</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="form-grid">
          <Field label={t('名称')} hint={name && !nameOk ? t('只能用字母、数字、- 和 _，且不能重名') : t('工具名会变成 mcp__名称__工具')}>
            <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="sentry" autoFocus />
          </Field>
          <Field label={t('类型')}>
            <Seg value={type} onChange={setType} items={[{ value: 'stdio', label: t('本地命令 stdio') }, { value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }]} />
          </Field>
        </div>
        {type === 'stdio' ? (
          <>
            <Field label={t('命令和参数')}><input className="input mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @sentry/mcp-server" /></Field>
            <Field label={t('环境变量')} hint={t('每行一个 KEY=value')}><textarea className="textarea mono" rows={3} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="SENTRY_TOKEN=..." /></Field>
          </>
        ) : (
          <>
            <Field label="URL"><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" /></Field>
            <Field label={t('请求头')} hint={t('每行一个 Key: Value；令牌保存在本机服务端，不发到浏览器')}><textarea className="textarea mono" rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer ..." /></Field>
          </>
        )}
        <div className="form-grid">
          <Field label={t('工具超时（秒）')}><input className="input" inputMode="numeric" value={timeout} onChange={(e) => setTimeoutS(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label={t('适用范围')}>
            <Seg value={scope} onChange={setScope} items={[{ value: 'global', label: t('所有工作区') }, { value: 'workspace', label: t('{w}（仅本机）', { w: wsName }) }]} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
