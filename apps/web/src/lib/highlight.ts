/** Syntax highlighting for code blocks, diffs and the file preview (highlight.js, common languages only). */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import ini from 'highlight.js/lib/languages/ini';

const LANGS = { bash, c, cpp, csharp, css, diff, go, java, javascript, json, kotlin, markdown, php, powershell, python, ruby, rust, sql, swift, typescript, xml, yaml, ini };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);

const BY_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', css: 'css', scss: 'css', less: 'css', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', php: 'php',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', env: 'bash', diff: 'diff', patch: 'diff',
};
const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', ps: 'powershell', ps1: 'powershell', py: 'python', rb: 'ruby', rs: 'rust', html: 'xml', yml: 'yaml', toml: 'ini', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', jsx: 'javascript', tsx: 'typescript' };

/** The language of a fence label (```ts) or a file name, if we know it. */
export function languageOf(labelOrFile: string | undefined): string | undefined {
  if (!labelOrFile) return undefined;
  const s = labelOrFile.trim().toLowerCase();
  if (hljs.getLanguage(s)) return ALIASES[s] ?? s;
  if (ALIASES[s]) return ALIASES[s];
  const ext = /\.([a-z0-9+]+)$/.exec(s)?.[1];
  return ext ? BY_EXT[ext] : undefined;
}

/** A language for an unlabelled code block, when highlight.js is fairly sure. */
const guessed = new Map<string, string>();
export function guessLanguage(code: string): string | undefined {
  if (code.length > 20_000) return undefined;
  const hit = guessed.get(code);
  if (hit !== undefined) return hit || undefined;
  const r = hljs.highlightAuto(code, Object.keys(LANGS).filter((l) => l !== 'diff' && l !== 'markdown'));
  const lang = r.relevance >= 6 ? r.language ?? '' : '';
  if (guessed.size > 400) guessed.delete(guessed.keys().next().value!);
  guessed.set(code, lang);
  return lang || undefined;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Recent results: transcripts re-render often (streaming) with the same code. */
const cache = new Map<string, string>();
const remember = (key: string, value: string) => {
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
};

/** Highlighted HTML (escaped text when the language is unknown or the code is huge). */
export function highlight(code: string, lang?: string): string {
  if (!lang || code.length > 200_000) return esc(code);
  const key = `${lang}:${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    return remember(key, hljs.highlight(code, { language: lang, ignoreIllegals: true }).value);
  } catch {
    return esc(code);
  }
}

/** Highlighted HTML per line, with spans that cross a line break closed and reopened. */
export function highlightLines(code: string, lang?: string): string[] {
  const html = highlight(code, lang);
  const out: string[] = [];
  let open: string[] = [];
  for (const line of html.split('\n')) {
    let text = open.join('') + line;
    for (const m of line.matchAll(/<span[^>]*>|<\/span>/g)) {
      if (m[0] === '</span>') open.pop();
      else open.push(m[0]);
    }
    text += '</span>'.repeat(open.length);
    out.push(text);
  }
  return out;
}
