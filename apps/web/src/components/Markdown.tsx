/** Markdown as Claude writes it: headings, lists, code blocks, tables, quotes, links, images, and board ids as links. */
import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { linkify } from './BoardLink';
import { imageSrc, Thumb } from './Thumb';
import { guessLanguage, highlight, languageOf } from '../lib/highlight';

type Block =
  | { t: 'code'; lang: string; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'hr' }
  | { t: 'quote'; text: string }
  | { t: 'table'; head: string[]; rows: string[][]; align: Array<'left' | 'center' | 'right' | undefined> }
  | { t: 'list'; ordered: boolean; start: number; items: Array<{ text: string; sub: string; task?: boolean; done?: boolean }> }
  | { t: 'p'; text: string };

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i += 1;
      out.push({ t: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i += 1; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: 'hr' }); i += 1; continue; }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: body.join('\n') });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' as const : c.endsWith(':') ? 'right' as const : c.startsWith(':') ? 'left' as const : undefined));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ t: 'table', head, rows, align });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const indent = li[1].length;
      const ordered = /\d/.test(li[2]);
      const items: Array<{ text: string; sub: string; task?: boolean; done?: boolean }> = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m && m[1].length <= indent + 1 && /\d/.test(m[2]) === ordered) {
          const task = /^\[([ xX])\]\s+/.exec(m[3]);
          items.push({ text: task ? m[3].slice(task[0].length) : m[3], sub: '', ...(task ? { task: true, done: task[1] !== ' ' } : {}) });
          i += 1;
          continue;
        }
        // Nested lines and continuation lines belong to the last item.
        if (lines[i].trim() && (/^\s+/.test(lines[i]) || (!m && !/^#{1,6}\s/.test(lines[i]) && !/^\s*```/.test(lines[i]) && items.length && lines[i - 1]?.trim()))) {
          const last = items[items.length - 1];
          const stripped = lines[i].replace(new RegExp(`^\\s{0,${indent + 4}}`), '');
          if (LIST.test(lines[i]) || last.sub) last.sub += `${stripped}\n`;
          else last.text += ` ${stripped.trim()}`;
          i += 1;
          continue;
        }
        if (!lines[i].trim() && LIST.test(lines[i + 1] ?? '') && (LIST.exec(lines[i + 1])![1].length >= indent)) { i += 1; continue; }
        break;
      }
      out.push({ t: 'list', ordered, start: ordered ? Number(/\d+/.exec(li[2])![0]) : 1, items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !(LIST.test(lines[i]) && body.length === 0)) {
      if (LIST.test(lines[i])) break;
      body.push(lines[i++]);
    }
    if (!body.length) { body.push(lines[i++]); }
    out.push({ t: 'p', text: body.join('\n') });
  }
  return out;
}

/** Inline: `code`, **bold**, *italic*, ![images](src), [links](url), bare URLs and board ids. */
export function inline(text: string, wsId?: string, sid?: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([^*]+?)\*\*|__([^_]+?)__|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?!\w)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|\n/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(<Fragment key={k++}>{linkify(text.slice(last, m.index), wsId)}</Fragment>);
    if (m[2] !== undefined) parts.push(<code key={k++}>{m[2].replace(/^ (.*) $/, '$1')}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) parts.push(<b key={k++}>{inline(m[3] ?? m[4], wsId, sid)}</b>);
    else if (m[5] !== undefined) parts.push(<i key={k++}>{inline(m[5], wsId, sid)}</i>);
    else if (m[7] !== undefined) {
      const src = imageSrc(m[7], sid);
      parts.push(src ? <Thumb key={k++} src={src} alt={m[6]} /> : <Fragment key={k++}>{m[0]}</Fragment>);
    } else if (m[8] !== undefined) parts.push(<a key={k++} href={m[9]} target="_blank" rel="noreferrer">{inline(m[8], wsId, sid)}</a>);
    else if (m[10] !== undefined) parts.push(<a key={k++} href={m[10]} target="_blank" rel="noreferrer">{m[10]}</a>);
    else parts.push(<br key={k++} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{linkify(text.slice(last), wsId)}</Fragment>);
  return parts;
}

function render(blocks: Block[], wsId?: string, sid?: string): ReactNode {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'code':
        return <pre key={i} className="md-code" data-lang={b.lang || undefined}><code dangerouslySetInnerHTML={{ __html: highlight(b.text, languageOf(b.lang) ?? guessLanguage(b.text)) }} /></pre>;
      case 'h': {
        const Tag = `h${Math.min(6, b.level + 2)}` as 'h3';
        return <Tag key={i} className="md-h">{inline(b.text, wsId, sid)}</Tag>;
      }
      case 'hr':
        return <hr key={i} />;
      case 'quote':
        return <blockquote key={i}>{render(parse(b.text), wsId, sid)}</blockquote>;
      case 'table':
        return (
          <div key={i} className="md-table"><table>
            <thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: b.align[j] }}>{inline(c, wsId, sid)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{b.head.map((_, x) => <td key={x} style={{ textAlign: b.align[x] }}>{inline(r[x] ?? '', wsId, sid)}</td>)}</tr>)}</tbody>
          </table></div>
        );
      case 'list': {
        const items = b.items.map((it, j) => (
          <li key={j} className={it.task ? 'task' : undefined}>
            {it.task && <input type="checkbox" checked={it.done} readOnly />}
            {inline(it.text, wsId, sid)}
            {it.sub && render(parse(it.sub), wsId, sid)}
          </li>
        ));
        return b.ordered ? <ol key={i} start={b.start}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      default:
        return <p key={i}>{inline(b.text, wsId, sid)}</p>;
    }
  });
}

/** One block, rendered again only when it changed: a reply that streams in redraws only its last block. */
const MdBlock = memo(
  function MdBlock({ block, wsId, sid }: { block: Block; wsId?: string; sid?: string }) {
    return <>{render([block], wsId, sid)}</>;
  },
  (a, b) => a.wsId === b.wsId && a.sid === b.sid && (a.block === b.block || JSON.stringify(a.block) === JSON.stringify(b.block)),
);

export const Markdown = memo(function Markdown({ text, wsId, sid, className }: { text: string; wsId?: string; sid?: string; className?: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  return <div className={className ?? 'md'}>{blocks.map((b, i) => <MdBlock key={i} block={b} wsId={wsId} sid={sid} />)}</div>;
});
