/** Small UI primitives shared by every page. */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { cx } from '../lib/util';
import { useApp } from '../store/app';
import { useT } from '../lib/i18n';
import { initialOf } from '@code-agent/shared/initial';

type BtnVariant = 'primary' | 'danger' | 'danger-outline' | 'soft' | 'ghost' | 'default';

/**
 * A button. When onClick returns a promise (a call to the server), the button shows a spinner and
 * stays disabled until it settles, so a slow action never looks like a missed click.
 */
export function Button({ children, icon, variant = 'default', size, onClick, disabled, title, className, iconRight, type = 'button', style, loading }: {
  children?: ReactNode; icon?: string; variant?: BtnVariant; size?: 'sm' | 'lg'; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => unknown;
  disabled?: boolean; title?: string; className?: string; iconRight?: string; type?: 'button' | 'submit'; style?: CSSProperties;
  /** Show the spinner regardless of onClick (work started elsewhere). */
  loading?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const spinning = loading || busy;
  const click = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = onClick?.(e);
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setBusy(true);
      (r as Promise<unknown>).then(() => undefined, () => undefined).finally(() => { if (alive.current) setBusy(false); });
    }
  };
  return (
    <button
      type={type}
      className={cx('btn', variant !== 'default' && variant, size, !children && 'icon-only', spinning && 'busy', className)}
      onClick={click}
      disabled={disabled || spinning}
      aria-busy={spinning || undefined}
      title={title}
      aria-label={!children ? title : undefined}
      style={style}
    >
      {spinning ? <span className="spinner" /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

export function Chip({ children, tone, icon, mono, onRemove, title, className }: {
  children: ReactNode; tone?: 'accent' | 'warn' | 'crit' | 'good' | 'outline'; icon?: string; mono?: boolean; onRemove?: () => void; title?: string; className?: string;
}) {
  return (
    <span className={cx('chip', tone, mono && 'mono', className)} title={title}>
      {icon && <Icon name={icon} size={12} />}
      {children}
      {onRemove && (
        <span className="x" role="button" aria-label="移除" onClick={onRemove}>
          <Icon name="x" size={11} />
        </span>
      )}
    </span>
  );
}

export function Status({ tone, children }: { tone: 'good' | 'warn' | 'crit' | 'info' | 'idle'; children: ReactNode }) {
  const icon = { good: 'check', warn: 'warning', crit: 'x', info: 'info', idle: 'clock' }[tone];
  return (
    <span className={cx('status', tone)}>
      <Icon name={icon} size={12} strokeWidth={2.2} />
      {children}
    </span>
  );
}

export function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange?: (v: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('toggle', on && 'on', disabled && 'disabled')} onClick={(e) => { e.preventDefault(); if (!disabled) onChange?.(!on); }}>
      <span className="track" role="switch" aria-checked={on} />
      {label && <span>{label}</span>}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <span className={cx('check', on && 'on')} role="checkbox" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="box">{on && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
      <span>{label}</span>
    </span>
  );
}

export function Radio({ on, onChange, label, className }: { on: boolean; onChange: () => void; label?: ReactNode; className?: string }) {
  return (
    <span className={cx('radio', on && 'on', className)} role="radio" aria-checked={on} onClick={onChange}>
      <span className="dot" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Seg<T extends string>({ items, value, onChange, disabled }: {
  items: Array<{ value: T; label: string; disabled?: boolean }>; value: T; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup">
      {items.map((it) => (
        <button key={it.value} className={cx(it.value === value && 'on')} disabled={disabled || it.disabled} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ items, value, onChange, className }: {
  items: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={cx('tabs', className)} role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={it.value === value} className={cx(it.value === value && 'on')} onClick={() => onChange(it.value)}>
          {it.label}
          {it.count !== undefined && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- popover

/** A popover anchored to an element; closes on outside click or Escape-free blur. */
export function Popover({ anchor, open, onClose, children, placement = 'bottom-start', width, className, offset = 6 }: {
  anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start'; width?: number; className?: string; offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const place = () => {
      if (!anchor || !ref.current) return;
      const a = anchor.getBoundingClientRect();
      const p = ref.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = placement.startsWith('top') ? a.top - p.height - offset : a.bottom + offset;
      let left = placement.endsWith('end') ? a.right - p.width : a.left;
      if (placement === 'right-start') { top = a.top; left = a.right + offset; }
      if (top + p.height > vh - 8) top = Math.max(8, a.top - p.height - offset);
      if (top < 8) top = Math.min(a.bottom + offset, vh - p.height - 8);
      left = Math.min(Math.max(8, left), vw - p.width - 8);
      setPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, placement, width, offset, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className={cx('popover', className)} style={{ ...pos, width }}>
      {children}
    </div>,
    document.body,
  );
}

export interface MenuOption<T> {
  value: T;
  label: ReactNode;
  desc?: ReactNode;
  icon?: string;
  right?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** Draw a separator line above this option. */
  dividerBefore?: boolean;
}

/** Dropdown select built on Popover. */
export function Select<T extends string>({ value, options, onChange, icon, size, className, width, placement, renderValue, disabled, title }: {
  value: T; options: MenuOption<T>[]; onChange: (v: T) => void; icon?: string; size?: 'sm'; className?: string;
  width?: number; placement?: 'bottom-start' | 'top-start' | 'bottom-end' | 'top-end'; renderValue?: (o: MenuOption<T> | undefined) => ReactNode; disabled?: boolean; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const cur = options.find((o) => o.value === value);
  return (
    <>
      <button ref={btn} type="button" className={cx('select-btn', size, className)} onClick={() => setOpen(!open)} disabled={disabled} title={title}>
        {icon && <Icon name={icon} size={15} className="muted" />}
        <span className="label">{renderValue ? renderValue(cur) : cur?.label}</span>
        <Icon name="chevDown" size={14} className="muted" />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} placement={placement} width={width}>
        {options.map((o) => (
          <Fragment key={o.value}>
            {o.dividerBefore && <div className="menu-sep" />}
            <button
              className={cx('menu-item', o.value === value && 'on', o.danger && 'danger')}
              disabled={o.disabled}
              onClick={() => { setOpen(false); onChange(o.value); }}
            >
              {o.icon && <Icon name={o.icon} size={15} />}
              <span className="grow">
                {o.label}
                {o.desc && <span className="desc">{o.desc}</span>}
              </span>
              {o.right && <span className="right">{o.right}</span>}
              {o.value === value && <Icon name="check" size={14} />}
            </button>
          </Fragment>
        ))}
      </Popover>
    </>
  );
}

/** Button that opens a menu of actions. */
export function MenuButton({ children, items, icon, variant = 'ghost', size, title, placement = 'bottom-end', width }: {
  children?: ReactNode; items: Array<MenuOption<string> & { onSelect: () => void } | 'sep'>; icon?: string; variant?: BtnVariant; size?: 'sm';
  title?: string; placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} style={{ display: 'inline-flex' }}>
      <Button icon={icon} variant={variant} size={size} title={title} onClick={() => setOpen(!open)}>{children}</Button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} placement={placement} width={width}>
        {items.map((it, i) => it === 'sep' ? <div key={i} className="menu-sep" /> : (
          <button key={it.value} className={cx('menu-item', it.danger && 'danger')} disabled={it.disabled} onClick={() => { setOpen(false); it.onSelect(); }}>
            {it.icon && <Icon name={it.icon} size={15} />}
            <span className="grow">{it.label}{it.desc && <span className="desc">{it.desc}</span>}</span>
            {it.right && <span className="right">{it.right}</span>}
          </button>
        ))}
      </Popover>
    </span>
  );
}

// ---------------------------------------------------------------- modal

export function Modal({ title, sub, onClose, children, footer, width, footLeft }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; footLeft?: ReactNode;
}) {
  const t = useT();
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={width ? { width: `min(${width}px, calc(100vw - 40px))` } : undefined} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <Button variant="ghost" icon="x" title={t('关闭')} onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {(footer || footLeft) && <div className="modal-foot">{footLeft && <div className="left">{footLeft}</div>}{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Global confirmation dialog driven by useApp().ask(). */
export function ConfirmHost() {
  const t = useT();
  const confirm = useApp((s) => s.confirm);
  const set = useApp((s) => s.set);
  if (!confirm) return null;
  const close = () => set({ confirm: null });
  return (
    <Modal
      title={confirm.title}
      onClose={close}
      width={480}
      footer={
        <>
          <Button onClick={close}>{t('取消')}</Button>
          <Button variant={confirm.danger ? 'danger' : 'primary'} onClick={async () => {
            // Stay open with a spinner while the confirmed action talks to the server.
            try { await confirm.onConfirm(); } finally { close(); }
          }}>{confirm.confirmLabel}</Button>
        </>
      }
    >
      <div style={{ whiteSpace: 'pre-line', color: 'var(--ink-2)' }}>{confirm.body}</div>
    </Modal>
  );
}

/** The user's avatar: the first character of the computer's user name, a person icon when it has none. */
export function UserAvatar({ size = 13 }: { size?: number }) {
  const name = useApp((s) => s.userName);
  const initial = initialOf(name);
  return <span className="avatar" title={name || undefined}>{initial || <Icon name="user" size={size} />}</span>;
}

export function Toasts() {
  // Toasts from the server carry Chinese text; translating text that already is English is a no-op.
  const tr = useT();
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.tone)}>
          <Icon name={t.tone === 'good' ? 'check' : t.tone === 'warn' ? 'warning' : t.tone === 'crit' ? 'x' : 'info'} size={15} />
          <span>{tr(t.text)}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{tr(t.action.label)}</button>}
          <button onClick={() => dismiss(t.id)} aria-label={tr('关闭')}><Icon name="x" size={13} /></button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Field({ label, children, hint }: { label?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return <div className="progress"><div style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} /></div>;
}
