/**
 * P21 — permission rules. Rules live in Claude Code's own settings files, so they apply the same
 * way when the user runs `claude` in a terminal. Two writable scopes (all workspaces / one
 * workspace on this machine) plus read-only rules committed with the repository.
 */
import { useMemo, useState } from 'react';
import type { PermissionRule } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Button, Chip, Seg, Select } from '../../components/ui';
import { useApp } from '../../store/app';
import { NoWorkspace, useWorkspaceChoice } from '../../components/NoWorkspace';
import { buildRule, describeRule, evaluate, type RuleKind } from '../../lib/rules';
import { uid } from '../../lib/util';
import { useT } from '../../lib/i18n';

const BEHAVIORS = [
  { value: 'allow', label: '允许', desc: '直接执行，不再问你', tone: 'good' },
  { value: 'ask', label: '询问', desc: '每次都先问你，即使有允许规则', tone: 'warn' },
  { value: 'deny', label: '拒绝', desc: '一律禁止，优先级最高', tone: 'crit' },
] as const;
type Behavior = PermissionRule['behavior'];

const KINDS: Array<{ value: RuleKind; label: string; field: string; placeholder: string; hint: string }> = [
  { value: 'bash', label: '运行命令', field: '命令', placeholder: 'npm test', hint: '' },
  { value: 'edit', label: '修改文件', field: '路径', placeholder: 'src/**', hint: '相对工作区；** 表示任意层子目录；以 // 开头是绝对路径；留空表示所有文件' },
  { value: 'read', label: '读取文件', field: '路径', placeholder: '.env*', hint: '只写文件名时匹配任意位置的同名文件；留空表示所有文件' },
  { value: 'web', label: '抓取网页', field: '域名', placeholder: 'github.com', hint: '留空表示所有网站' },
  { value: 'mcp', label: 'MCP 工具', field: '服务器', placeholder: 'github', hint: '' },
  { value: 'agent', label: '子代理', field: '名称', placeholder: 'Explore', hint: '' },
  { value: 'skill', label: '技能', field: '名称', placeholder: 'code-review', hint: '' },
  { value: 'raw', label: '直接写规则', field: '规则', placeholder: 'Bash(git log *)', hint: '格式：工具名(匹配内容)' },
];

const TRY_TOOLS = [
  { value: 'Bash', label: '命令', placeholder: 'git status && npm test' },
  { value: 'Edit', label: '修改文件', placeholder: 'src/cart/timer.ts' },
  { value: 'Read', label: '读取文件', placeholder: '.env.local' },
  { value: 'WebFetch', label: '抓取网页', placeholder: 'https://pastebin.com/abc' },
];

export function Permissions() {
  const t = useT();
  const app = useApp();
  const [scope, setScope] = useState<'global' | 'workspace'>('global');
  const [wsId, setWsId] = useWorkspaceChoice();
  const ws = app.workspaces.find((w) => w.id === wsId);

  const own = app.rules.filter((r) => (scope === 'global' ? r.scope === 'global' : r.scope === 'workspace' && r.workspaceId === wsId));
  const repo = scope === 'workspace' ? app.rules.filter((r) => r.scope === 'repo' && r.workspaceId === wsId) : [];
  const globalCount = app.rules.filter((r) => r.scope === 'global').length;
  const effective = scope === 'global' ? own : [...app.rules.filter((r) => r.scope === 'global'), ...own, ...repo];
  const file = scope === 'global' ? '~/.claude/settings.json' : `${ws?.path ?? ''}\\.claude\\settings.local.json`;

  const add = (behavior: Behavior, rule: string) => {
    app.set({ rules: [...app.rules, { id: uid('r'), behavior, rule, scope, workspaceId: scope === 'workspace' ? wsId : undefined }] });
    app.toast(t('已添加：{d}', { d: describeRule(rule) }), 'good');
  };

  return (
    <>
      <h1>{t('权限规则')}</h1>
      <p className="lead">{t('决定 Claude 调用工具时直接执行、先问你、还是禁止。规则保存在 Claude Code 自己的设置文件里，在终端里直接用 claude 时同样生效。')}</p>

      <div className="eval-strip">
        <span className="hint" style={{ marginRight: 6 }}>{t('每次调用按顺序判断，命中即停：')}</span>
        <div className="eval-step deny"><b>{t('1 拒绝规则')}</b><span>{t('命中即禁止')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step"><b>{t('2 询问规则')}</b><span>{t('命中即问你')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step"><b>{t('3 权限模式')}</b><span>{t('如「自动接受编辑」')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step"><b>{t('4 允许规则')}</b><span>{t('命中即执行')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step you"><b>{t('5 问你')}</b><span>{t('「不询问」模式下直接拒绝')}</span></div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <Seg value={scope} onChange={setScope} items={[{ value: 'global', label: t('所有工作区') }, { value: 'workspace', label: t('单个工作区') }]} />
        {scope === 'workspace' && wsId && (
          <Select value={wsId} onChange={setWsId} icon="folder" className="w-240" options={app.workspaces.map((w) => ({ value: w.id, label: w.name, desc: w.path }))} />
        )}
        {(scope === 'global' || wsId) && <span className="hint mono" title={t('规则保存的位置')}>{file}</span>}
      </div>

      {scope === 'workspace' && !wsId ? <NoWorkspace text={t('单个工作区的规则保存在工作区的 .claude/settings.local.json 里。添加一个工作区后才能设置。')} /> : (
      <div className="rules-grid">
        <div>
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <h3>{scope === 'global' ? t('对所有工作区生效') : t('只对 {w} 生效（仅本机）', { w: ws?.name ?? '' })}</h3>
              <span className="grow" />
              {scope === 'workspace' && globalCount > 0 && (
                <button className="link-btn" onClick={() => setScope('global')}>{t('另有 {n} 条全局规则同时生效 →', { n: globalCount })}</button>
              )}
            </div>
            <RuleList rules={own} editable />
            <RuleEditor onAdd={add} />
          </div>

          <DirsPanel scope={scope} wsId={wsId} wsPath={ws?.path ?? ''} />

          {scope === 'workspace' && (
            <div className="panel">
              <div className="panel-head">
                <h3>{t('来自仓库')}</h3>
                <span className="sub mono">.claude/settings.json</span>
                <span className="grow" />
                <span className="hint">{t('随代码提交，团队共享；这里只读')}</span>
              </div>
              {repo.length ? <RuleList rules={repo} /> : <div className="empty">{t('这个仓库没有提交权限规则')}</div>}
            </div>
          )}
          <div className="hint" style={{ marginTop: 10 }}>
            {t('审批时选「以后不再询问」或「把目录加为额外目录」也会添加到这里；选「仅本会话」的不写入文件，会话结束就失效。')}
          </div>
        </div>

        <TryIt rules={effective} dirs={scope === 'workspace' && ws ? [ws.path, ...app.dirs.filter((d) => d.scope === 'global' || (d.scope === 'workspace' && d.workspaceId === wsId)).map((d) => d.path)] : null}
          scopeLabel={scope === 'global' ? t('全局规则') : t('全局 + {w} 的规则', { w: ws?.name ?? '' })} />
      </div>
      )}
    </>
  );
}

function RuleList({ rules, editable }: { rules: PermissionRule[]; editable?: boolean }) {
  const t = useT();
  const app = useApp();
  if (rules.length === 0) return <div className="empty">{t('还没有规则。没有命中规则的调用按权限模式处理。')}</div>;
  const order: Behavior[] = ['deny', 'ask', 'allow'];
  const sorted = [...rules].sort((a, b) => order.indexOf(a.behavior) - order.indexOf(b.behavior));
  return (
    <div className="rule-list">
      {sorted.map((r) => {
        const b = BEHAVIORS.find((x) => x.value === r.behavior)!;
        return (
          <div key={r.id} className="rule-row">
            <Chip tone={b.tone}>{t(b.label)}</Chip>
            <div className="grow">
              <div>{describeRule(r.rule)}</div>
              <div className="mono muted" style={{ fontSize: 11.5 }}>{r.rule}</div>
            </div>
            {editable && <Button size="sm" variant="ghost" icon="trash" title={t('删除')} onClick={() => app.set({ rules: app.rules.filter((x) => x.id !== r.id) })} />}
          </div>
        );
      })}
    </div>
  );
}

function RuleEditor({ onAdd }: { onAdd: (behavior: Behavior, rule: string) => void }) {
  const t = useT();
  const [behavior, setBehavior] = useState<Behavior>('allow');
  const [kind, setKind] = useState<RuleKind>('bash');
  const [bashMode, setBashMode] = useState<'prefix' | 'exact' | 'all'>('prefix');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const k = KINDS.find((x) => x.value === kind)!;
  const rule = buildRule(kind, a, b, bashMode);
  const valid = !!rule && (kind !== 'raw' || /^[\w-]+(\(.*\))?$/.test(rule)) && (kind !== 'mcp' || !!a.trim());
  const reset = () => { setA(''); setB(''); };

  return (
    <div className="rule-editor">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <b>{t('添加规则')}</b>
        <Select<Behavior> size="sm" value={behavior} onChange={setBehavior} width={260} className="w-140"
          options={BEHAVIORS.map((x) => ({ value: x.value, label: t(x.label), desc: t(x.desc) }))} />
        <Select<RuleKind> size="sm" value={kind} onChange={(v) => { setKind(v); reset(); }} width={200} className="w-140"
          options={KINDS.map((x) => ({ value: x.value, label: t(x.label) }))} />
        {kind === 'bash' && (
          <Seg value={bashMode} onChange={setBashMode} items={[{ value: 'prefix', label: t('以…开头') }, { value: 'exact', label: t('完全等于') }, { value: 'all', label: t('所有命令') }]} />
        )}
      </div>
      {!(kind === 'bash' && bashMode === 'all') && (
        <div className="row">
          <span className="field-label" style={{ width: 48 }}>{t(k.field)}</span>
          <input className="input sm mono grow" placeholder={k.placeholder} value={a} onChange={(e) => setA(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && valid) { onAdd(behavior, rule); reset(); } }} />
          {kind === 'mcp' && <input className="input sm mono" style={{ width: 180 }} placeholder={t('工具名（留空为全部）')} value={b} onChange={(e) => setB(e.target.value)} />}
        </div>
      )}
      {k.hint && <div className="hint">{t(k.hint)}</div>}
      {kind === 'bash' && bashMode === 'prefix' && <div className="hint">{t('「以 npm test 开头」也包括单独的 npm test。用 && 或 | 连起来的命令会拆开逐段检查。')}</div>}
      <div className="row">
        <span className="hint grow">
          {valid ? <>{t('将添加：')}<b className="ink2">{t(BEHAVIORS.find((x) => x.value === behavior)!.label)} · {describeRule(rule)}</b> <span className="mono">{rule}</span></> : t('填写后预览')}
        </span>
        <Button size="sm" variant="primary" icon="plus" disabled={!valid} onClick={() => { onAdd(behavior, rule); reset(); }}>{t('添加')}</Button>
      </div>
    </div>
  );
}

const isAbsolute = (p: string) => /^[a-z]:[\\/]|^\\\\|^\//i.test(p.trim());
const within = (p: string, dir: string) => {
  const a = p.trim().replace(/\//g, '\\').toLowerCase();
  const d = dir.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return a === d || a.startsWith(`${d}\\`);
};

function TryIt({ rules, dirs, scopeLabel }: { rules: PermissionRule[]; dirs: string[] | null; scopeLabel: string }) {
  const t = useT();
  const [tool, setTool] = useState('Bash');
  const [input, setInput] = useState('');
  const cur = TRY_TOOLS.find((x) => x.value === tool)!;
  const o = useMemo(() => (input.trim() ? evaluate(rules, tool, input) : null), [rules, tool, input]);
  const verdict = o && (o.kind === 'deny'
    ? { tone: 'crit' as const, text: t('禁止') }
    : o.kind === 'ask' ? { tone: 'warn' as const, text: t('先问你') }
      : o.kind === 'allow' ? { tone: 'good' as const, text: t('直接执行') }
        : { tone: 'outline' as const, text: t('没有命中规则') });

  return (
    <div className="panel" style={{ alignSelf: 'start' }}>
      <div className="panel-head"><h3>{t('试一试')}</h3><span className="sub">{scopeLabel}</span></div>
      <div className="panel-body col">
        <Seg value={tool} onChange={(v) => { setTool(v); setInput(''); }} items={TRY_TOOLS.map((x) => ({ value: x.value, label: t(x.label) }))} />
        <input className="input mono" placeholder={cur.placeholder} value={input} onChange={(e) => setInput(e.target.value)} />
        {o && verdict && (
          <div className="try-result">
            <Chip tone={verdict.tone}>{verdict.text}</Chip>
            {o.kind !== 'none' ? (
              <div className="hint">
                {t('命中规则')} <span className="mono">{o.rule.rule}</span>
                {o.part && <> · {t('命中的部分：')}<span className="mono">{o.part}</span></>}
              </div>
            ) : (
              <div className="hint">
                {o.unmatched && <>{t('「{p}」没有允许规则，所以整条命令不能直接执行。', { p: o.unmatched })} </>}
                {(tool === 'Read' || tool === 'Edit') && isAbsolute(input) && dirs && !dirs.some((d) => within(input, d))
                  ? t('这个路径在工作区和额外目录之外：读取和修改都会先问你，那时可以顺手把目录加为额外目录。')
                  : t('交给权限模式：「编辑前询问」会问你；「自动接受编辑」会直接修改工作区（含额外目录）内的文件；只读命令和工作区内的读取不需要询问。')}
              </div>
            )}
          </div>
        )}
        <div className="hint">{t('这里按 Claude Code 的规则做近似判断，实际以 Claude Code 为准。')}</div>
      </div>
    </div>
  );
}

/** Directories outside the workspace that Claude may use like the workspace itself. */
function DirsPanel({ scope, wsId, wsPath }: { scope: 'global' | 'workspace'; wsId: string; wsPath: string }) {
  const t = useT();
  const app = useApp();
  const [path, setPath] = useState('');
  const own = app.dirs.filter((d) => (scope === 'global' ? d.scope === 'global' : d.scope === 'workspace' && d.workspaceId === wsId));
  const globalCount = app.dirs.filter((d) => d.scope === 'global').length;
  const valid = isAbsolute(path) && !own.some((d) => d.path.toLowerCase() === path.trim().toLowerCase());
  const add = () => {
    app.set({ dirs: [...app.dirs, { id: uid('dir'), path: path.trim().replace(/[\\/]+$/, ''), scope, workspaceId: scope === 'workspace' ? wsId : undefined }] });
    setPath('');
  };
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <h3>{t('额外可访问的目录')}</h3>
        <span className="grow" />
        {scope === 'workspace' && globalCount > 0 && <span className="hint">{t('另有 {n} 个全局目录同时生效', { n: globalCount })}</span>}
      </div>
      <div className="panel-body col">
        <div className="hint">
          {scope === 'workspace'
            ? t('除了工作区 {w}，Claude 还可以使用这些目录：里面的文件直接读取，修改按权限模式处理。只授予文件访问，不加载那里的 CLAUDE.md 和设置。', { w: wsPath })
            : t('对所有工作区生效。里面的文件直接读取，修改按权限模式处理。')}
        </div>
        {own.length === 0 && <div className="muted">{t('还没有添加目录。对话中 Claude 访问工作区外的文件时，也可以在审批里直接添加。')}</div>}
        {own.map((d) => (
          <div key={d.id} className="dir-row">
            <Icon name="folder" size={15} className="muted" />
            <span className="mono grow">{d.path}</span>
            <Button size="sm" variant="ghost" icon="trash" title={t('移除')} onClick={() => app.set({ dirs: app.dirs.filter((x) => x.id !== d.id) })} />
          </div>
        ))}
        <div className="row">
          <input className="input sm mono grow" placeholder="D:\src\shared-lib" value={path} onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && valid) add(); }} />
          <Button size="sm" icon="plus" disabled={!valid} onClick={add}>{t('添加目录')}</Button>
        </div>
      </div>
    </div>
  );
}
