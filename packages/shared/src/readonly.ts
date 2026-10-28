/**
 * Shell commands the code reviewer may run without asking: reading the repository, never changing
 * it or starting another program. Anything not clearly read-only is refused, because a reviewer
 * reading untrusted repository content can be prompt-injected.
 */
import { splitCommand } from './rules';

/** Split one command into words; quotes group, they are not kept. */
function words(s: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) return null;
  if (has || cur) out.push(cur);
  return out;
}

const SIMPLE = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'pwd', 'echo', 'stat', 'du', 'which', 'where', 'grep', 'egrep', 'fgrep', 'findstr',
  'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'sls', 'get-item', 'gi', 'test-path', 'measure-object', 'measure',
  'get-location', 'resolve-path',
]);

const GIT_READ = new Set([
  'diff', 'log', 'show', 'status', 'blame', 'ls-files', 'ls-tree', 'cat-file', 'merge-base', 'describe', 'shortlog', 'rev-parse',
  'rev-list', 'grep', 'name-rev', 'show-ref', 'whatchanged',
]);

/** Options of read-only git subcommands that write files or run programs. */
const GIT_BAD_OPT = /^(--output|-O|--open-files-in-pager|--ext-diff)/;

function gitOk(args: string[]): boolean {
  let i = 0;
  // Only harmless global options: -C <dir>, --no-pager.
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C') i += 2;
    else if (args[i] === '--no-pager') i += 1;
    else return false;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  const flags = rest.filter((a) => a.startsWith('-'));
  const positional = rest.filter((a) => !a.startsWith('-'));
  if (!sub) return false;
  if (GIT_READ.has(sub)) return !rest.some((a) => GIT_BAD_OPT.test(a));
  switch (sub) {
    case 'branch': {
      const ok = ['-a', '-r', '-v', '-vv', '-l', '--list', '--all', '--remotes', '--verbose', '--show-current', '--merged', '--no-merged', '--contains', '--no-contains', '--no-color', '--color'];
      if (!flags.every((f) => ok.includes(f) || f.startsWith('--sort=') || f.startsWith('--format='))) return false;
      // A bare name creates a branch; names are only patterns with --list or values of --contains / --merged.
      return positional.length === 0 || flags.some((f) => ['-l', '--list', '--contains', '--no-contains', '--merged', '--no-merged'].includes(f));
    }
    case 'tag':
      return flags.every((f) => ['-l', '--list', '-n', '--contains', '--merged', '--no-merged'].includes(f) || f.startsWith('--sort=') || /^-n\d+$/.test(f))
        && (positional.length === 0 || flags.some((f) => f === '-l' || f === '--list' || f === '--contains'));
    case 'remote':
      return rest.length === 0 || (rest.length === 1 && rest[0] === '-v') || rest[0] === 'show' || rest[0] === 'get-url';
    case 'config':
      return ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(rest[0] ?? '');
    case 'stash':
      return rest[0] === 'list' || rest[0] === 'show';
    case 'worktree':
      return rest[0] === 'list';
    default:
      return false;
  }
}

function partOk(segment: string): boolean {
  const w = words(segment);
  if (!w?.length) return false;
  // FOO=bar cmd … can change what the command runs (GIT_EXTERNAL_DIFF, PAGER…).
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) return false;
  const name = (w[0].split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '');
  const args = w.slice(1);
  if (name === 'git') return gitOk(args);
  if (name === 'rg') return !args.some((a) => a.startsWith('--pre'));
  if (name === 'find') return !args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a));
  if (name === 'tree') return !args.some((a) => a === '-o' || a.startsWith('-o'));
  if (name === 'file') return !args.some((a) => a.startsWith('-C') || a === '--compile');
  return SIMPLE.has(name);
}

export function readOnlyCommand(cmd: string): boolean {
  // Redirects, command / variable substitution, PowerShell subexpressions and script blocks.
  if (/[<>`{}]|\$\(|\$\{|@\(|\r/.test(cmd.replace(/2>&1/g, ''))) return false;
  const parts = splitCommand(cmd.replace(/2>&1/g, ''));
  return parts.length > 0 && parts.every(partOk);
}
