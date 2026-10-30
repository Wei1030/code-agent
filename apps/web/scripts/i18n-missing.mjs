// Lists the Chinese UI strings that have no English entry in src/lib/i18n.en.ts, and the entries
// whose string no source uses any more.
//   npm run i18n:missing -w @code-agent/web
// Every Chinese string literal in the web app and the shared package counts (tables of labels are
// passed through t() later), so a few that are never shown may be listed too.
// The server's text counts as well: a template becomes a key with a {placeholder} per expression
// (named after an identifier or a property, numbered otherwise), which the web app matches as a
// pattern (lib/i18n.ts). A statement or property after a comment holding "i18n-ignore" is skipped:
// prompts Claude reads, exported files, console output.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const server = path.resolve(web, '../server/src');
const roots = [path.join(web, 'src'), path.resolve(web, '../../packages/shared/src'), server];
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) for (const n of readdirSync(p)) walk(path.join(p, n));
  else if (/\.tsx?$/.test(p) && !p.endsWith('i18n.en.ts') && !p.endsWith('.test.ts')) files.push(p);
};
roots.forEach(walk);

const CJK = /[㐀-鿿＀-￯　-〿]/;

/** `a${x}b${o.y}c${f()}` → "a{x}b{y}c{0}" */
function templateKey(n) {
  const used = new Set();
  let i = 0;
  return n.head.text + n.templateSpans.map((s) => {
    const e = s.expression;
    let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : String(i++);
    while (used.has(name)) name += '_';
    used.add(name);
    return `{${name}}${s.literal.text}`;
  }).join('');
}

const strings = new Set();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const isServer = f.startsWith(server);
  const src = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ignored = (n) => (ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []).some((c) => text.slice(c.pos, c.end).includes('i18n-ignore'));
  const visit = (n) => {
    if (ignored(n)) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CJK.test(n.text)) strings.add(n.text);
    if (ts.isJsxText(n) && CJK.test(n.text) && n.text.trim()) strings.add(n.text.trim());
    if (ts.isTemplateExpression(n) && CJK.test(n.head.text + n.templateSpans.map((s) => s.literal.text).join(''))) strings.add(templateKey(n));
    ts.forEachChild(n, visit);
  };
  visit(src);
}

const have = new Set();
for (const line of readFileSync(path.join(web, 'src', 'lib', 'i18n.en.ts'), 'utf8').split('\n')) {
  const m = /^ {2}("(?:[^"\\]|\\.)*"): /.exec(line);
  if (m) have.add(JSON.parse(m[1]));
}
const missing = [...strings].filter((s) => !have.has(s)).sort();
const unused = [...have].filter((s) => !strings.has(s)).sort();
console.log(missing.length ? JSON.stringify(missing, null, 1) : 'Every UI string has an English entry.');
if (unused.length) console.log(`English entries no source uses:
${JSON.stringify(unused, null, 1)}`);
process.exitCode = missing.length || unused.length ? 1 : 0;
