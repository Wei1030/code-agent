/** Open a file of a session in the inspector's 文件 tab, optionally marking some lines. */
import { useApp } from '../store/app';

export function openPreview(sid: string, file: { path: string; from?: number; to?: number }) {
  const app = useApp.getState();
  app.set({ preview: { sid, ...file } });
  app.setInspector({ open: true, tab: 'file' });
}
