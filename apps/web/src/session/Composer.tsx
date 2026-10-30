/** Message composer: "+" attachments, "/" commands, "@" session and file mentions, model / effort / mode, send. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, Effort, PermissionMode, SessionRef, SessionRuntime } from '../api/types';
import { api } from '../api';
import { COMMANDS, MODE_INFO, type CommandInfo, type FsNode } from '../lib/catalog';
import { effortOptions, modelOptions, takesEffort } from '../lib/models';
import { Icon } from '../components/Icon';
import { Button, MenuButton, Popover, Progress, Select } from '../components/ui';
import { useApp } from '../store/app';
import { cx, uid } from '../lib/util';
import { relTime, tokens as fmtTokens } from '../lib/format';
import { useT } from '../lib/i18n';

const PASTE_CHIP_LINES = 12;

type Palette =
  | { kind: 'command'; start: number; query: string }
  | { kind: 'mention'; start: number; query: string }
  | null;

/** Find a "/" or "@" token that ends at the caret. */
function detectPalette(text: string, caret: number): Palette {
  const before = text.slice(0, caret);
  const slash = /^\/([^\s]*)$/.exec(before);
  if (slash) return { kind: 'command', start: 0, query: slash[1] };
  const at = /(^|\s)@([^\s]*)$/.exec(before);
  if (at) return { kind: 'mention', start: caret - at[2].length - 1, query: at[2] };
  return null;
}

function listDir(tree: FsNode[], path: string[]): FsNode[] {
  let cur = tree;
  for (const p of path) cur = cur.find((n) => n.name === p && n.dir)?.children ?? [];
  return [...cur].sort((a, b) => Number(!!b.dir) - Number(!!a.dir) || a.name.localeCompare(b.name));
}

function flatten(tree: FsNode[], prefix = ''): string[] {
  return tree.flatMap((n) => {
    const p = prefix + n.name + (n.dir ? '/' : '');
    return n.dir ? [p, ...flatten(n.children ?? [], p)] : [p];
  });
}

/**
 * Unsent input per session. It outlives the composer (other pages, a restart that briefly shows the
 * session as saved); the text is also kept in localStorage, so a reload does not lose it.
 */
const drafts = new Map<string, { text: string; atts: Attachment[]; refs: SessionRef[] }>();
const DRAFTS_KEY = 'code-agent.drafts';
function storedText(sid: string): string {
  try {
    return (JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>)[sid] ?? '';
  } catch {
    return '';
  }
}
function storeText(sid: string, text: string) {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as Record<string, string>;
    if (text) all[sid] = text;
    else delete all[sid];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the in-memory draft still holds.
  }
}

/** The input of one session (SessionPage keys it by session, so its state is that session's). */
export function Composer({ rt, workspaceId, disabled, onInterrupt }: {
  rt: SessionRuntime; workspaceId: string; disabled?: boolean; onInterrupt: (queued: number) => void;
}) {
  const t = useT();
  const sid = rt.id;
  const app = useApp();
  const [text, setText] = useState(() => drafts.get(sid)?.text ?? storedText(sid));
  const [atts, setAtts] = useState<Attachment[]>(() => drafts.get(sid)?.atts ?? []);
  const [refs, setRefs] = useState<SessionRef[]>(() => drafts.get(sid)?.refs ?? []);
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const [palette, setPalette] = useState<Palette>(null);
  const [active, setActive] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const running = rt.state !== 'idle';
  const waiting = !!app.sessions.find((s) => s.id === sid)?.waiting;

  useEffect(() => {
    drafts.set(sid, { text, atts, refs });
    storeText(sid, text);
  }, [sid, text, atts, refs]);

  // Text pushed from elsewhere ("answer in your own words").
  const fill = app.fill;
  useEffect(() => {
    if (!fill || fill.sid !== sid) return;
    setText(fill.text);
    // Once: coming back to the page must not put it back over what was typed since.
    useApp.getState().set({ fill: null });
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(fill.text.length, fill.text.length);
    });
  }, [fill, sid]);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(260, el.scrollHeight)}px`;
  }, [text]);

  // ------------------------------------------------------------ palette data
  const [tree, setTree] = useState<FsNode[] | null>(null);
  const [sdkCommands, setSdkCommands] = useState<CommandInfo[]>([]);
  const paletteKind = palette?.kind;
  useEffect(() => {
    if (paletteKind !== 'mention') return;
    let live = true;
    void api.listFiles(workspaceId).then((t) => live && setTree(t)).catch(() => live && setTree([]));
    return () => { live = false; };
  }, [paletteKind, workspaceId]);
  useEffect(() => {
    if (paletteKind !== 'command') return;
    let live = true;
    void api.listCommands(sid).then((c) => live && setSdkCommands(c));
    return () => { live = false; };
  }, [paletteKind, sid]);
  const allPaths = useMemo(() => flatten(tree ?? []), [tree]);
  // Built-in commands, then skills you can invoke, command files and MCP prompts for this workspace.
  const allCommands = useMemo<CommandInfo[]>(() => {
    const inWs = <T extends { source: string; workspaceId?: string }>(x: T) => x.source !== 'workspace' || x.workspaceId === workspaceId;
    const where = (src: string, plugin?: string) => (src === 'plugin' ? `插件 · ${plugin}` : src === 'workspace' ? '这个工作区' : src === 'bundled' ? '内置包' : '所有工作区');
    const base: CommandInfo[] = [
      ...COMMANDS,
      ...app.skills.filter((k) => inWs(k) && k.invocable !== 'model').map((k) => ({ name: `/${k.name}`, hint: k.description, origin: `技能 · ${where(k.source, k.plugin)}`, icon: 'spark' })),
      ...app.commandFiles.filter(inWs).map((c) => ({ name: `/${c.name}`, hint: [c.argHint, c.desc].filter(Boolean).join(' '), origin: `命令 · ${where(c.source, c.plugin)}`, icon: c.source === 'plugin' ? 'box' : 'file' })),
      ...app.mcp.filter((m) => (m.scope === 'global' || m.scope === 'plugin' || m.workspaceId === workspaceId) && m.status === 'connected')
        .flatMap((m) => m.prompts.map((p) => ({ name: `/mcp__${m.name}__${p.name}`, hint: p.desc, origin: `MCP · ${m.name}`, icon: 'plug' }))),
    ];
    // Claude Code's own commands that the lists above do not cover.
    const known = new Set(base.map((c) => c.name));
    return [...base, ...sdkCommands.filter((c) => !known.has(c.name))];
  }, [app.skills, app.commandFiles, app.mcp, workspaceId, sdkCommands]);
  const commandItems = useMemo(() => {
    if (palette?.kind !== 'command') return [];
    const q = palette.query.toLowerCase();
    return allCommands.filter((c) => c.name.slice(1).toLowerCase().includes(q));
  }, [palette, allCommands]);
  const mentionItems = useMemo(() => {
    if (palette?.kind !== 'mention') return [] as Array<{ path: string; name: string; dir: boolean }>;
    const q = palette.query;
    const slash = q.lastIndexOf('/');
    if (slash >= 0 || q === '') {
      // Browse: list the directory typed so far, filtered by the last segment.
      const dirPath = slash >= 0 ? q.slice(0, slash).split('/').filter(Boolean) : [];
      const leaf = slash >= 0 ? q.slice(slash + 1).toLowerCase() : '';
      return listDir(tree ?? [], dirPath)
        .filter((n) => n.name.toLowerCase().includes(leaf))
        .map((n) => ({ path: [...dirPath, n.name].join('/') + (n.dir ? '/' : ''), name: n.name, dir: !!n.dir }));
    }
    const lq = q.toLowerCase();
    return allPaths.filter((p) => p.toLowerCase().includes(lq)).slice(0, 12)
      .map((p) => ({ path: p, name: p, dir: p.endsWith('/') }));
  }, [palette, tree, allPaths]);
  // Other sessions in this workspace, before files; not while browsing into a folder.
  const sessionItems = useMemo(() => {
    if (palette?.kind !== 'mention' || palette.query.includes('/')) return [];
    const q = palette.query.toLowerCase();
    return app.sessions
      .filter((s) => s.workspaceId === workspaceId && s.id !== sid && !s.draft && !s.jobId && s.title.toLowerCase().includes(q))
      .sort((a, b) => b.lastActive - a.lastActive).slice(0, 5);
  }, [palette, app.sessions, workspaceId, sid]);
  const nSess = sessionItems.length;
  const count = palette?.kind === 'command' ? commandItems.length : nSess + mentionItems.length;
  useEffect(() => setActive(0), [palette?.kind, palette?.query]);

  const update = (value: string, caret: number) => {
    setText(value);
    setPalette(detectPalette(value, caret));
  };

  const replaceToken = (insert: string, keepOpen = false) => {
    if (!palette) return;
    const caret = ta.current?.selectionStart ?? text.length;
    const next = text.slice(0, palette.start) + insert + text.slice(caret);
    const pos = palette.start + insert.length;
    setText(next);
    setPalette(keepOpen ? detectPalette(next, pos) : null);
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(pos, pos); });
  };

  const pickCommand = (i: number) => {
    const c = commandItems[i];
    if (c) replaceToken(`${c.name} `);
  };
  const pickMention = (i: number) => {
    if (i < nSess) {
      const s = sessionItems[i];
      // i18n-ignore: text in the message.
      replaceToken(`@会话「${s.title}」 `);
      setRefs((r) => [...r.filter((x) => x.sessionId !== s.id), { sessionId: s.id, title: s.title }]);
      return;
    }
    const m = mentionItems[i - nSess];
    if (!m) return;
    if (m.dir) replaceToken(`@${m.path}`, true);
    else replaceToken(`@${m.path} `);
  };
  const crumbs = palette?.kind === 'mention' ? palette.query.split('/').slice(0, -1).filter(Boolean) : [];

  // ------------------------------------------------------------ attachments
  const addFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((f) => {
      const isImage = f.type.startsWith('image/');
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const att: Attachment = { id: uid('att'), kind: isImage ? 'image' : 'file', name: f.name, meta: `${Math.max(1, Math.round(f.size / 1024))} KB` };
      const r = new FileReader();
      if (isImage || isPdf) {
        r.onload = () => setAtts((a) => a.map((x) => (x.id === att.id ? { ...x, content: String(r.result) } : x)));
        r.readAsDataURL(f);
      } else if (f.size <= 2 * 1024 * 1024) {
        // Text files go in as text; binary ones only by name.
        r.onload = () => {
          const text = String(r.result);
          setAtts((a) => a.map((x) => (x.id === att.id ? (text.includes('\u0000') ? { ...x, meta: `${x.meta} · ${t('二进制，只发送文件名')}` } : { ...x, content: text }) : x)));
        };
        r.readAsText(f);
      } else {
        att.meta = `${att.meta} · ${t('太大，只发送文件名')}`;
      }
      setAtts((a) => [...a, att]);
    });
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
      return;
    }
    const pasted = e.clipboardData.getData('text');
    const lines = pasted.split('\n').length;
    if (lines > PASTE_CHIP_LINES) {
      e.preventDefault();
      setAtts((a) => [...a, { id: uid('att'), kind: 'paste', name: t('粘贴的文本'), meta: t('{n} 行', { n: lines }), content: pasted }]);
    }
  };

  // ------------------------------------------------------------ send
  const canSend = (text.trim().length > 0 || atts.length > 0) && !disabled;
  const doSend = (opts: { priority?: 'now' | 'next' | 'later'; contextOnly?: boolean; verbatim?: boolean } = {}) => {
    if (!canSend) return;
    // i18n-ignore: text in the message.
    api.send(sid, text.trim(), { attachments: atts, refs: refs.filter((r) => text.includes(`@会话「${r.title}」`)), ...opts });
    if ((running || waiting) && rt.request?.kind !== 'question' && !opts.contextOnly && opts.priority !== 'now') app.toast(t('已加入队列'), 'info');
    setText('');
    setAtts([]);
    setRefs([]);
    setPalette(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (palette && count > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % count); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + count) % count); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (palette.kind === 'command') pickCommand(active);
        else pickMention(active);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setPalette(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  // ------------------------------------------------------------ settings
  const model = app.models.find((m) => m.id === rt.model);
  const ctxUsed = rt.context.categories.filter((c) => c.kind === 'used').reduce((a, c) => a + c.tokens, 0);
  const ctxPct = rt.context.max ? (ctxUsed / rt.context.max) * 100 : 0;
  const pickMode = (m: PermissionMode) => {
    if (m !== 'bypassPermissions') { api.setMode(sid, m); return; }
    app.ask({
      title: t('切换到「跳过权限检查」？'),
      body: t('所有工具调用都不再询问，直接执行（拒绝规则仍然生效）。只建议在隔离的环境中使用。'),
      confirmLabel: t('切换'), danger: true,
      onConfirm: () => api.setMode(sid, m),
    });
  };
  const placeholder = disabled
    ? t('会话未运行')
    : waiting
      ? t('在等空位；现在发送的消息会排队，开始后依次处理 · Enter 发送 · Shift+Enter 换行')
    : rt.request?.kind === 'question'
      ? t('也可以直接用自己的话回答 · Enter 发送 · Shift+Enter 换行')
      : rt.request
      ? t('Claude 在等你处理上面的请求；在这里输入的消息会排队 · Enter 发送 · Shift+Enter 换行')
      : running
      ? t('Claude 正在工作，新消息会排队；也可以立即插入 · Enter 发送 · Shift+Enter 换行')
      : t('输入问题；/ 调用命令，@ 引用会话或文件 · Enter 发送 · Shift+Enter 换行');

  return (
    <div
      ref={box}
      className={cx('composer', focus && 'focus', drag && 'drag')}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
    >
      {atts.length > 0 && (
        <div className="c-atts">
          {atts.map((a) => (
            <div key={a.id} className="c-att" title={a.kind === 'paste' ? a.content?.slice(0, 400) : a.name}>
              <span className="thumb">
                {a.kind === 'image' && a.content ? <img src={a.content} alt="" /> : <Icon name={a.kind === 'image' ? 'image' : a.kind === 'paste' ? 'clip' : 'file'} size={15} />}
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <div className="truncate">{a.name}</div>
                <div className="meta">{a.meta}</div>
              </span>
              <span className="x" role="button" aria-label={t('移除')} onClick={() => setAtts(atts.filter((x) => x.id !== a.id))}><Icon name="x" size={13} /></span>
            </div>
          ))}
        </div>
      )}
      <div className="c-row1">
        <span className="c-plus">
          <MenuButton icon="plus" variant="ghost" title={t('添加附件')} placement="top-start" width={240} items={[
            { value: 'image', icon: 'image', label: t('图片…'), desc: t('从本机选择图片'), onSelect: () => imageInput.current?.click() },
            { value: 'file', icon: 'file', label: t('文件…'), desc: t('任意文件，作为附件发送'), onSelect: () => fileInput.current?.click() },
            { value: 'mention', icon: 'at', label: t('引用会话或文件'), desc: t('等同于输入 @'), onSelect: () => { const v = `${text}${text && !text.endsWith(' ') ? ' ' : ''}@`; update(v, v.length); ta.current?.focus(); } },
          ]} />
        </span>
        <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <textarea
          ref={ta}
          className="c-input"
          rows={2}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onClick={(e) => setPalette(detectPalette(text, (e.target as HTMLTextAreaElement).selectionStart))}
        />
      </div>
      <div className="c-row2">
        <Select size="sm" icon="cpu" value={rt.model} width={280} placement="top-start" title={t('模型')} disabled={disabled}
          onChange={(v) => api.setModel(sid, v)}
          options={modelOptions(app.models, t)} />
        <Select<Effort> size="sm" icon="bulb" value={rt.effort} width={220} placement="top-start" title={takesEffort(model) ? t('思考强度') : t('这个模型不接收思考强度')} disabled={disabled || !takesEffort(model)}
          onChange={(v) => api.setEffort(sid, v)}
          renderValue={(o) => <>{t('思考')} · {o?.label}</>}
          options={effortOptions(model, rt.effort, t)} />
        <Select<PermissionMode> size="sm" icon={MODE_INFO[rt.mode].icon} value={rt.mode} width={320} placement="top-start" title={t('权限模式')} disabled={disabled}
          onChange={pickMode}
          options={(Object.keys(MODE_INFO) as PermissionMode[]).map((m) => ({
            value: m, icon: MODE_INFO[m].icon, label: t(MODE_INFO[m].label), desc: t(MODE_INFO[m].desc),
          }))} />
        <div className="ctx-meter" title={t('上下文 {u} / {m}，点击展开或收起明细', { u: fmtTokens(ctxUsed), m: fmtTokens(rt.context.max) })}
          onClick={() => app.setInspector(app.inspector.open && app.inspector.tab === 'context' ? { open: false } : { open: true, tab: 'context' })}>
          <div className="l"><span>{t('上下文')}</span><span>{Math.round(ctxPct)}%</span></div>
          <Progress value={ctxPct} color={ctxPct > 80 ? 'var(--warn)' : undefined} />
        </div>
        <div className="c-right">
          {running ? (
            <>
              <Button size="sm" variant="danger-outline" icon="stop" title={t('中断本轮，Claude 停在当前位置')} onClick={() => api.interrupt(sid).then((q) => onInterrupt(q.length))}>{t('中断')}</Button>
              <span className="split">
                <Button size="sm" variant="primary" icon="queue" disabled={!canSend} onClick={() => doSend()}>{t('排队')}</Button>
                <MenuButton icon="chevDown" variant="primary" size="sm" title={t('发送方式')} placement="top-end" width={300} items={[
                  { value: 'now', icon: 'bolt', label: t('立即插入'), desc: t('Claude 马上读到；正在运行的工作转入后台'), disabled: !canSend, onSelect: () => doSend({ priority: 'now' }) },
                  { value: 'next', icon: 'queue', label: t('工具后'), desc: t('当前这批工具调用结束后读取'), disabled: !canSend, onSelect: () => doSend({ priority: 'next' }) },
                  { value: 'later', icon: 'clock', label: t('下一轮'), desc: t('本轮结束后作为新一轮发送'), disabled: !canSend, onSelect: () => doSend({ priority: 'later' }) },
                ]} />
              </span>
            </>
          ) : (
            <span className="split">
              <Button size="sm" variant="primary" icon="send" disabled={!canSend} onClick={() => doSend()}>{t('发送')}</Button>
              <MenuButton icon="chevDown" variant="primary" size="sm" title={t('发送方式')} placement="top-end" width={300} items={[
                { value: 'send', icon: 'send', label: t('发送'), desc: t('开始新一轮'), disabled: !canSend, onSelect: () => doSend() },
                { value: 'context', icon: 'layers', label: t('仅作为上下文'), desc: t('加入对话，但不开始新一轮'), disabled: !canSend, onSelect: () => doSend({ contextOnly: true }) },
                { value: 'verbatim', icon: 'slash', label: t('原样发送'), desc: t('以 / 开头也不当作命令'), disabled: !canSend, onSelect: () => doSend({ verbatim: true }) },
              ]} />
            </span>
          )}
        </div>
      </div>

      <Popover anchor={box.current} open={!!palette && focus} onClose={() => setPalette(null)} placement="top-start" width={460} className="palette">
        {palette?.kind === 'command' && (
          <>
            <div className="ph"><span>{t('命令')}</span><span>{t('{n} 个', { n: commandItems.length })}</span></div>
            {commandItems.length === 0 && <div className="pi muted">{t('没有匹配的命令')}</div>}
            {commandItems.map((c, i) => (
              <div key={c.name} className={cx('pi', i === active && 'active')} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pickCommand(i); }}>
                <Icon name={c.icon} size={15} className="muted" />
                <span className="n">{c.name}</span>
                <span className="h grow truncate">{t(c.hint)}</span>
                <span className="h">{t(c.origin)}</span>
              </div>
            ))}
            <div className="pf">{t('↑↓ 选择 · Enter 插入 · 继续输入可筛选')}</div>
          </>
        )}
        {palette?.kind === 'mention' && (
          <>
            {nSess > 0 && (
              <>
                <div className="ph"><span>{t('会话')}</span><span>{t('同一工作区 · Claude 可以读取它的记录和状态')}</span></div>
                {sessionItems.map((s, i) => (
                  <div key={s.id} className={cx('pi', i === active && 'active')} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pickMention(i); }}>
                    <Icon name="chat" size={15} className="accent" />
                    <span className="grow truncate">{s.title}</span>
                    <span className="h">{s.live && s.state === 'running' ? t('运行中') : s.live && s.state === 'requires_action' ? t('等你处理') : relTime(s.lastActive)}</span>
                  </div>
                ))}
              </>
            )}
            <div className="ph">
              <span className="crumb">
                <span role="button" style={{ cursor: 'pointer' }} onMouseDown={(e) => { e.preventDefault(); replaceToken('@', true); }}>{app.workspaces.find((w) => w.id === workspaceId)?.name ?? '.'}</span>
                {crumbs.map((c, i) => (
                  <span key={i}> / <span role="button" style={{ cursor: 'pointer' }} onMouseDown={(e) => { e.preventDefault(); replaceToken(`@${crumbs.slice(0, i + 1).join('/')}/`, true); }}>{c}</span></span>
                ))}
              </span>
              <span>{palette.query && !palette.query.includes('/') ? t('搜索结果') : t('当前目录')}</span>
            </div>
            {mentionItems.length === 0 && <div className="pi muted">{tree === null ? <><span className="spinner" /> {t('正在读取工作区文件…')}</> : t('没有匹配的文件')}</div>}
            {crumbs.length > 0 && (
              <div className="pi" onMouseDown={(e) => { e.preventDefault(); replaceToken(crumbs.length > 1 ? `@${crumbs.slice(0, -1).join('/')}/` : '@', true); }}>
                <Icon name="chevLeft" size={15} className="muted" /><span className="h">{t('上一级')}</span>
              </div>
            )}
            {mentionItems.map((m, i) => (
              <div key={m.path} className={cx('pi', i + nSess === active && 'active')} onMouseEnter={() => setActive(i + nSess)} onMouseDown={(e) => { e.preventDefault(); pickMention(i + nSess); }}>
                <Icon name={m.dir ? 'folder' : 'file'} size={15} className={m.dir ? 'accent' : 'muted'} />
                <span className="grow mono truncate" style={{ fontSize: 12.5 }}>{m.name}</span>
                {m.dir && <Icon name="chevRight" size={14} className="muted" />}
              </div>
            ))}
            <div className="pf">{t('↑↓ 选择 · Enter 引用会话、文件或进入文件夹 · 输入可搜索')}</div>
          </>
        )}
      </Popover>
    </div>
  );
}
