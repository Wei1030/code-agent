/** Settings shell with its sub-navigation, plus small form helpers shared by the settings pages. */
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useT } from '../../lib/i18n';

const NAV = [
  { to: '/settings/profiles', label: '配置方案', icon: 'layers' },
  { to: '/settings/permissions', label: '权限规则与沙箱', icon: 'shield' },
  { to: '/settings/provider', label: '模型服务与账号', icon: 'key' },
  { to: '/settings/language', label: '语言与地区', icon: 'globe' },
];

export function SettingsLayout() {
  const t = useT();
  return (
    <div className="settings">
      <nav className="settings-nav">
        <h2>{t('设置')}</h2>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="row"><Icon name={n.icon} size={15} />{t(n.label)}</span>
          </NavLink>
        ))}
        <div className="hint" style={{ margin: '18px 12px 0', lineHeight: 1.6 }}>
          {t('MCP 服务器、技能、子代理、钩子、插件和自定义工具将在后续版本中提供。')}
        </div>
      </nav>
      <div className="settings-main"><Outlet /></div>
    </div>
  );
}

/** Editable list of short mono strings (tool names, domains, paths). */
export function ChipsInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="chips-input">
      {values.map((v) => (
        <span key={v} className="chip mono">
          {v}
          <span className="x" role="button" aria-label="移除" onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" size={11} /></span>
        </span>
      ))}
      <input value={draft} placeholder={values.length ? '' : placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }} />
    </div>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="form-section">
      <h3 className="row">{title}{right && <span style={{ marginLeft: 'auto', fontWeight: 400 }}>{right}</span>}</h3>
      {children}
    </div>
  );
}
