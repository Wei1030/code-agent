/** P19 — usage in tokens; subscription limits (5-hour window and week). */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Progress, Seg, Select } from '../components/ui';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useApp } from '../store/app';
import { relTime, tokens as fmt, num } from '../lib/format';
import { useT } from '../lib/i18n';

const SERIES = [
  { key: 'opus', label: 'Opus', color: 'var(--s1)' },
  { key: 'fable', label: 'Fable', color: 'var(--s4, #b46ad8)' },
  { key: 'sonnet', label: 'Sonnet', color: 'var(--s2)' },
  { key: 'haiku', label: 'Haiku', color: 'var(--s3)' },
  { key: 'other', label: '其他', color: 'var(--muted)' },
] as const;
type SeriesKey = (typeof SERIES)[number]['key'];
type Day = { date: number } & Record<SeriesKey, number>;

const DAY = 86_400_000;
const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function untilText(ts: number | null, t: (s: string, v?: Record<string, string | number>) => string): string {
  if (!ts) return '';
  const ms = ts - Date.now();
  if (ms <= 0) return t('即将重置');
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  if (h >= 24) { const d = new Date(ts); return t('{d} 重置', { d: `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }); }
  return h ? t('{h} 小时 {m} 分后重置', { h, m }) : t('{m} 分钟后重置', { m });
}

export function Usage() {
  const t = useT();
  const nav = useNavigate();
  const workspaces = useApp((s) => s.workspaces);
  const sessions = useApp((s) => s.sessions);
  const provider = useApp((s) => s.provider);
  const usage = useApp((s) => s.usage);
  useEffect(() => { void api.refreshUsage(); }, []);
  const [range, setRange] = useState<'7' | '30'>('30');
  const [wsFilter, setWsFilter] = useState('all');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hover, setHover] = useState<number | null>(null);

  const days = useMemo<Day[]>(() => {
    const n = Number(range);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return Array.from({ length: n }, (_, i) => {
      const date = start.getTime() - (n - 1 - i) * DAY;
      const d: Day = { date, opus: 0, fable: 0, sonnet: 0, haiku: 0, other: 0 };
      for (const [k, v] of Object.entries(usage.days[dayKey(date)] ?? {})) {
        const [ws, fam] = k.split('\t');
        if (wsFilter !== 'all' && ws !== wsFilter) continue;
        const key = (SERIES.some((s) => s.key === fam) ? fam : 'other') as SeriesKey;
        d[key] += v;
      }
      return d;
    });
  }, [range, wsFilter, usage.days]);
  const total = (d: Day) => SERIES.reduce((a, s) => a + d[s.key], 0);
  const cacheRatio = useMemo(() => {
    let input = 0; let read = 0;
    for (const d of days) { const c = usage.cache?.[dayKey(d.date)]; if (c) { input += c.input; read += c.cacheRead; } }
    return input ? Math.round((read / input) * 100) : null;
  }, [days, usage.cache]);
  const series = SERIES.filter((s) => s.key !== 'other' || days.some((d) => d.other > 0));
  const sum = days.reduce((a, d) => a + total(d), 0);
  const today = days[days.length - 1];
  const bySeries = SERIES.map((s) => ({ ...s, v: days.reduce((a, d) => a + d[s.key], 0) })).filter((s) => s.v > 0);
  const filteredSessions = sessions.filter((s) => !s.draft && (wsFilter === 'all' || s.workspaceId === wsFilter));
  const top = [...filteredSessions].sort((a, b) => b.tokens - a.tokens).slice(0, 6);
  const byWs = workspaces.map((w) => ({ w, v: days.reduce((a, d) => a + Object.entries(usage.days[dayKey(d.date)] ?? {}).reduce((b, [k, v]) => b + (k.split('\t')[0] === w.id ? v : 0), 0), 0) }))
    .filter((x) => x.v > 0 && (wsFilter === 'all' || x.w.id === wsFilter)).sort((a, b) => b.v - a.v);
  const wsMax = Math.max(1, ...byWs.map((x) => x.v));

  // ------------------------------------------------------------ chart geometry
  const W = 760, H = 260, padL = 48, padB = 26, padT = 12;
  const max = Math.max(...days.map(total));
  const step = max > 2_000_000 ? 500_000 : max > 200_000 ? 50_000 : max > 20_000 ? 5_000 : 1_000;
  const niceMax = Math.ceil(max / step) * step || 1;
  const bw = (W - padL - 8) / days.length;
  const y = (v: number) => H - padB - ((H - padB - padT) * v) / niceMax;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const peak = days.reduce((m, d, i) => (total(d) > total(days[m]) ? i : m), 0);
  const fmtDay = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          <h1>{t('用量')}</h1>
          <span className="grow" />
          <Select value={wsFilter} onChange={setWsFilter} icon="folder" className="w-180"
            options={[{ value: 'all', label: t('全部工作区') }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
          <Seg value={range} onChange={setRange} items={[{ value: '7', label: t('近 7 天') }, { value: '30', label: t('近 30 天') }]} />
        </div>
        <p className="page-sub">{t('全部按 token 统计（输入 + 输出 + 缓存）。数据来自每轮结束时的 usage 字段。')}</p>

        <div className="tiles">
          <div className="tile"><div className="k">{t('今天')}</div><div className="v">{fmt(total(today))}</div><div className="s">tokens</div></div>
          <div className="tile"><div className="k">{t('近 {n} 天合计', { n: range })}</div><div className="v">{fmt(sum)}</div><div className="s">{t('日均 {a}', { a: fmt(Math.round(sum / days.length)) })}</div></div>
          <div className="tile"><div className="k">{t('会话数')}</div><div className="v">{filteredSessions.length}</div><div className="s">{t('平均每个会话 {a}', { a: fmt(Math.round(filteredSessions.reduce((a, s) => a + s.tokens, 0) / Math.max(1, filteredSessions.length))) })}</div></div>
          <div className="tile"><div className="k">{t('缓存命中')}</div><div className="v">{cacheRatio === null ? '—' : `${cacheRatio}%`}</div><div className="s">{t('输入 token 中来自缓存的比例')}</div></div>
        </div>

        <div className="usage-grid">
          <div className="panel">
            <div className="panel-head">
              <b>{t('每日 token · 按模型')}</b>
              <span className="grow" />
              <div className="chart-legend">
                {series.map((s) => <span key={s.key}><span className="sw" style={{ background: s.color }} />{s.label}</span>)}
              </div>
              <Seg value={view} onChange={setView} items={[{ value: 'chart', label: t('图表') }, { value: 'table', label: t('表格') }]} />
            </div>
            <div className="panel-body">
              {view === 'chart' ? (
                <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
                  <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('每日 token 堆叠柱状图')}>
                    {ticks.map((v) => (
                      <g key={v}>
                        <line x1={padL} x2={W - 4} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
                        <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{fmt(v)}</text>
                      </g>
                    ))}
                    {days.map((d, i) => {
                      let acc = 0;
                      const x = padL + i * bw + bw * 0.15;
                      const w = bw * 0.7;
                      return (
                        <g key={d.date} onMouseEnter={() => setHover(i)}>
                          <rect x={padL + i * bw} y={padT} width={bw} height={H - padB - padT} fill={hover === i ? 'var(--surface-3)' : 'transparent'} />
                          {series.map((s) => {
                            const v = d[s.key];
                            const r = <rect key={s.key} x={x} y={y(acc + v)} width={w} height={Math.max(0, y(acc) - y(acc + v) - (acc > 0 ? 1 : 0))} fill={s.color} rx={1.5} />;
                            acc += v;
                            return r;
                          })}
                          {(i % Math.ceil(days.length / 10) === 0 || i === days.length - 1) && (
                            <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{fmtDay(d.date)}</text>
                          )}
                        </g>
                      );
                    })}
                    <line x1={padL} x2={W - 4} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
                    <text x={padL + peak * bw + bw / 2} y={y(total(days[peak])) - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink-2)">
                      {t('峰值 {v}', { v: fmt(total(days[peak])) })}
                    </text>
                  </svg>
                  {hover !== null && (
                    <div className="chart-tip" style={{ left: `min(calc(${((padL + hover * bw + bw) / W) * 100}% + 8px), calc(100% - 200px))`, top: 10 }}>
                      <div className="h"><span>{fmtDay(days[hover].date)}</span><span>{fmt(total(days[hover]))}</span></div>
                      {series.map((s) => (
                        <div key={s.key} className="r"><span className="sw" style={{ background: s.color }} />{s.label}<span className="v">{num(days[hover][s.key])}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ maxHeight: 280, overflow: 'auto' }}>
                  <table className="data-table">
                    <thead><tr><th>{t('日期')}</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">{t('合计')}</th></tr></thead>
                    <tbody>
                      {[...days].reverse().map((d) => (
                        <tr key={d.date}><td>{fmtDay(d.date)}</td>{series.map((s) => <td key={s.key} className="num">{num(d[s.key])}</td>)}<td className="num"><b>{num(total(d))}</b></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row" style={{ marginTop: 10, gap: 18 }}>
                {bySeries.map((s) => (
                  <span key={s.key} className="ink2"><span className="sw" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: s.color, marginRight: 6 }} />{s.label} <b>{fmt(s.v)}</b> <span className="muted">({Math.round((s.v / Math.max(1, sum)) * 100)}%)</span></span>
                ))}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><b>{t('订阅限额')}</b><span className="grow" /><span className="hint">{provider.kind === 'subscription' ? `Claude ${provider.plan}` : ''}</span>
              <Button size="sm" variant="ghost" icon="refresh" title={t('向 Claude Code 重新读取')} onClick={() => void api.refreshUsage()} /></div>
            <div className="panel-body">
              {provider.kind !== 'subscription' ? (
                <div className="empty"><b>{t('当前使用兼容端点')}</b>{t('没有 Claude 订阅的 5 小时 / 每周限额。')}</div>
              ) : (
                <>
                  {[{ k: '5 小时窗口', icon: 'clock', w: usage.fiveHour }, { k: '本周', icon: 'gauge', w: usage.weekly }].map(({ k, icon, w }) => (
                    <div key={k} className="limit">
                      <div className="top"><Icon name={icon} size={15} className="muted" /><b>{t(k)}</b><span className="right">{w ? `${w.utilization}%` : '—'}</span></div>
                      <Progress value={w?.utilization ?? 0} />
                      <div className="hint" style={{ marginTop: 4 }}>{w ? untilText(w.resetsAt, t) : t('还没有读到')}</div>
                    </div>
                  ))}
                  <div className="hint">{t('限额由 Claude Code 报告，这里只做展示。')}{usage.checkedAt ? ` ${t('更新于 {t}', { t: relTime(usage.checkedAt) })}` : ''}</div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="usage-grid">
          <div className="panel">
            <div className="panel-head"><b>{t('消耗最多的会话')}</b></div>
            <div className="panel-body" style={{ padding: 0 }}>
              <table className="data-table">
                <thead><tr><th style={{ paddingLeft: 16 }}>{t('会话')}</th><th>{t('工作区')}</th><th className="num">tokens</th><th /></tr></thead>
                <tbody>
                  {top.length === 0 && <tr><td colSpan={4} className="muted" style={{ paddingLeft: 16 }}>{t('还没有会话')}</td></tr>}
                  {top.map((s) => (
                    <tr key={s.id}>
                      <td style={{ paddingLeft: 16 }}>{s.title}</td>
                      <td className="ink2">{workspaces.find((w) => w.id === s.workspaceId)?.name}</td>
                      <td className="num">{fmt(s.tokens)}</td>
                      <td className="num"><Button size="sm" variant="ghost" onClick={() => nav(`/s/${s.id}`)}>{t('打开')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><b>{t('按工作区')}</b></div>
            <div className="panel-body">
              {byWs.length === 0 && <div className="empty">{t('这段时间还没有用量')}</div>}
              {byWs.map(({ w, v }) => (
                <div key={w.id} className="bar-row">
                  <div className="top"><span>{w.name}</span><span>{fmt(v)}</span></div>
                  <div className="bar" style={{ width: `${(v / wsMax) * 100}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
