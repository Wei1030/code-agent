/** Open a URL in the default browser (not when CODE_AGENT_NO_OPEN is set, e.g. in tests). */
import { spawn } from 'node:child_process';

export function openBrowser(url: string) {
  if (process.env.CODE_AGENT_NO_OPEN) return;
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
  } catch {
    // No browser to open: the address is printed anyway.
  }
}
