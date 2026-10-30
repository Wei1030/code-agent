/** UI tests: the server environment plus a headless Chrome on the built web app. */
import path from 'node:path';
import { Browser, type Page } from './browser';
import { setup, type Env, type EnvOpts } from './env';

export interface UiEnv extends Env {
  browser: Browser;
  /** A tab at an app path. */
  page(p?: string): Promise<Page>;
}

export async function setupUi(opts: EnvOpts & { lang?: string } = {}): Promise<UiEnv> {
  const env = await setup({ ...opts, server: { ...opts.server, web: true } });
  const browser = await new Browser(path.join(env.world.root, 'browser'), env.server.url, opts.lang).start();
  const close = env.close;
  return Object.assign(env, {
    browser,
    page: (p?: string) => browser.page(p),
    async close() {
      browser.close();
      await close();
    },
  });
}

/** Fails with the page's errors, if any (call at the end of a test). */
export function noPageErrors(...pages: Page[]) {
  const errors = pages.flatMap((p) => p.errors);
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
}
