/**
 * Tell the user about something in a session they are not looking at: a toast in the app, plus a
 * system notification while the Code Agent tab is in the background.
 */
import { useApp, type Toast } from '../store/app';

export type NotifyKind = 'request' | 'turnDone' | 'background';

/** Requests still open when the page loads are shown in the inbox, not announced again. */
const quietUntil = Date.now() + 2500;

function go(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function notify(kind: NotifyKind, n: {
  title: string; body?: string; tone?: Toast['tone'];
  /** The page it is about; no toast while the user is on it. Defaults to the session's page. */
  sid?: string; path?: string;
  action?: string; open?: () => void;
}) {
  if (Date.now() < quietUntil) return;
  const app = useApp.getState();
  const p = app.prefs;
  if ((kind === 'request' && !p.notifyRequests) || (kind === 'turnDone' && !p.notifyTurnDone) || (kind === 'background' && !p.notifyBackground)) return;
  // '#inbox' means the inbox in the top bar rather than a page.
  const inbox = n.path === '#inbox';
  const path = inbox ? undefined : n.path ?? (n.sid ? `/s/${n.sid}` : undefined);
  const open = n.open ?? (inbox ? () => useApp.getState().set({ inboxOpen: true }) : path ? () => go(path) : undefined);
  if (!path || window.location.pathname !== path) {
    app.toast(n.body ? `${n.title}：${n.body}` : n.title, n.tone ?? 'info', open ? { label: n.action ?? '打开', run: open } : undefined);
  }
  const away = document.hidden || !document.hasFocus();
  if (away && p.browserNotifications && 'Notification' in window && Notification.permission === 'granted') {
    const sys = new Notification(n.title, { body: n.body, tag: `${kind}:${path ?? n.title}` });
    sys.onclick = () => { window.focus(); open?.(); sys.close(); };
  }
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
}

export function testNotification(): boolean {
  if (notificationPermission() !== 'granted') return false;
  new Notification('Code Agent', { body: '这是一条测试通知。会话等你处理或一轮完成时，会这样提醒你。' });
  return true;
}
