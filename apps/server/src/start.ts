/**
 * Entry point (npm start / npm run dev). Picks the port before the server is loaded: loading it
 * already touches the data (sessions running at the last stop come back saved), so a second server
 * on the same data dir must never get that far. If Code Agent on this data dir already answers on
 * one of the ports, that one is opened in the browser instead; a port taken by anything else is
 * skipped, up to 5 more.
 */
import net from 'node:net';
import { HOME, HOST, HOME_TAG, PORT, setPort } from './paths';
import { openBrowser } from './open';

const TRIES = 5;

function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, HOST, () => s.close(() => resolve(true)));
  });
}

/** Code Agent on this data dir answers on the port. */
async function ours(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://${HOST}:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
    return r.headers.get('x-code-agent-home') === HOME_TAG;
  } catch {
    return false;
  }
}

async function start() {
  for (let port = PORT; port <= PORT + TRIES; port++) {
    if (await free(port)) {
      if (port !== PORT) console.log(`端口 ${port === PORT + 1 ? PORT : `${PORT}–${port - 1}`} 已被占用，改用 ${port}`);
      setPort(port);
      await import('./main');
      return;
    }
    if (await ours(port)) {
      const url = `http://${HOST}:${port}/`;
      console.log(`Code Agent 已经在 ${url} 运行（数据目录 ${HOME}），不再启动第二个。`);
      openBrowser(url);
      process.exit(0);
    }
  }
  console.error(`端口 ${PORT}–${PORT + TRIES} 都被占用了。设置环境变量 CODE_AGENT_PORT 换一个端口再启动。`);
  process.exit(1);
}

void start();
