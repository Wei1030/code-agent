/*
 * SVG drawing kit for the Code Agent interaction prototype.
 * Every helper returns an SVG markup string; screens compose them.
 * Coordinates are absolute, in a 1440 x 900 canvas unless a screen says otherwise.
 */
(function () {
  'use strict';

  const C = {
    page: '#f3f4f6',
    surface: '#ffffff',
    surface2: '#f8f9fb',
    surface3: '#eef0f4',
    border: '#e2e5ea',
    borderStrong: '#cbd0d8',
    ink: '#111827',
    ink2: '#4b5563',
    muted: '#8b929e',
    accent: '#3b5bdb',
    accentInk: '#ffffff',
    accentSoft: '#e8edff',
    accentLine: '#b9c6f8',
    good: '#0ca30c',
    goodInk: '#006300',
    goodSoft: '#e7f6e7',
    warn: '#fab219',
    warnInk: '#8a5a00',
    warnSoft: '#fff5dc',
    serious: '#ec835a',
    crit: '#d03b3b',
    critSoft: '#fdeaea',
    codeBg: '#f6f8fa',
    addBg: '#e6f4ea',
    addInk: '#116329',
    delBg: '#fdecec',
    delInk: '#a40e26',
    marker: '#e5197d',
    overlay: 'rgba(15,23,42,0.38)',
    // Validated categorical slots (dataviz reference palette, light mode)
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    grid: '#e1e0d9',
    axis: '#c3c2b7',
  };

  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const MONO = "'Cascadia Code', Consolas, 'SFMono-Regular', Menlo, monospace";

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** Rough text width estimate, good enough for layout of mock UI. */
  function tw(s, size = 13, mono = false, bold = false) {
    if (mono) return String(s).length * size * 0.6;
    if (bold) return tw(s, size) * 1.08;
    let w = 0;
    for (const ch of String(s)) {
      if ('il.,:;|!\'` '.includes(ch)) w += 0.3;
      else if ('mwMW@'.includes(ch)) w += 0.85;
      else if (ch >= 'A' && ch <= 'Z') w += 0.66;
      else if (ch >= '0' && ch <= '9') w += 0.56;
      else w += 0.53;
    }
    return w * size;
  }

  function attrs(o) {
    return Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
  }

  function rect(x, y, w, h, o = {}) {
    return `<rect ${attrs({
      x, y, width: w, height: h, rx: o.r ?? 0,
      fill: o.fill ?? 'none', stroke: o.stroke, 'stroke-width': o.stroke ? (o.sw ?? 1) : undefined,
      'stroke-dasharray': o.dash, opacity: o.op, filter: o.shadow ? 'url(#sh)' : undefined,
    })}/>`;
  }

  function line(x1, y1, x2, y2, o = {}) {
    return `<line ${attrs({
      x1, y1, x2, y2, stroke: o.c ?? C.border, 'stroke-width': o.sw ?? 1,
      'stroke-dasharray': o.dash, 'marker-end': o.arrow ? 'url(#arr)' : undefined,
      'stroke-linecap': o.cap,
    })}/>`;
  }

  function path(d, o = {}) {
    return `<path ${attrs({
      d, fill: o.fill ?? 'none', stroke: o.c, 'stroke-width': o.c ? (o.sw ?? 1.5) : undefined,
      'stroke-dasharray': o.dash, 'marker-end': o.arrow ? 'url(#arr)' : undefined,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: o.op,
    })}/>`;
  }

  function circle(cx, cy, r, o = {}) {
    return `<circle ${attrs({
      cx, cy, r, fill: o.fill ?? 'none', stroke: o.stroke, 'stroke-width': o.stroke ? (o.sw ?? 1) : undefined,
    })}/>`;
  }

  /** Text. o: s=size, w=weight, c=color, a=anchor, m=mono, i=italic */
  function t(x, y, s, o = {}) {
    return `<text ${attrs({
      x, y, 'font-size': o.s ?? 13, 'font-weight': o.w ?? 400, fill: o.c ?? C.ink,
      'text-anchor': o.a, 'font-family': o.m ? MONO : FONT, 'font-style': o.i ? 'italic' : undefined,
      'letter-spacing': o.ls, 'text-decoration': o.u ? 'underline' : undefined,
    })}>${esc(s)}</text>`;
  }

  /** Text made of colored runs: [[text, color, weight], ...] */
  function runs(x, y, parts, o = {}) {
    const spans = parts
      .map(([s, c, w]) => `<tspan fill="${c ?? o.c ?? C.ink}"${w ? ` font-weight="${w}"` : ''}>${esc(s)}</tspan>`)
      .join('');
    return `<text ${attrs({
      x, y, 'font-size': o.s ?? 13, 'font-family': o.m ? MONO : FONT, 'xml:space': 'preserve',
    })}>${spans}</text>`;
  }

  /** Wrap text into lines of at most `maxW` pixels. */
  function wrap(s, maxW, size = 13, mono = false) {
    const words = String(s).split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (tw(next, size, mono) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Paragraph: wrapped text, returns markup. o.lh = line height */
  function para(x, y, s, maxW, o = {}) {
    const size = o.s ?? 13;
    const lh = o.lh ?? Math.round(size * 1.5);
    return wrap(s, maxW, size, o.m).map((ln, i) => t(x, y + i * lh, ln, o)).join('');
  }

  // ---------------------------------------------------------------- icons
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    chevUp: '<path d="M6 15l6-6 6 6"/>',
    chevRight: '<path d="M9 6l6 6-6 6"/>',
    chevLeft: '<path d="M15 6l-6 6 6 6"/>',
    chat: '<path d="M4 5h16v11H10l-6 4z"/>',
    agent: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4"/><circle cx="9.5" cy="13.5" r="1"/><circle cx="14.5" cy="13.5" r="1"/>',
    plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
    spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    hook: '<path d="M8 3v11a4.5 4.5 0 0 0 9 0v-4"/><path d="M14 12l3-3 3 3"/>',
    braces: '<path d="M9 4H8a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1"/>',
    chart: '<path d="M5 20V11M11 20V5M17 20v-6M3 20h18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
    pencil: '<path d="M4 20l1-5L16 4l4 4L9 19z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9a7 7 0 0 1-7 7H8"/>',
    rewind: '<path d="M11 7l-6 5 6 5zM19 7l-6 5 6 5z"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 8"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
    send: '<path d="M4 12l16-8-6 16-3-7z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="18" r=".8"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z"/>',
    clip: '<path d="M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/>',
    home: '<path d="M3 11l9-8 9 8v10H3z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    flag: '<path d="M5 21V4h12l-2.5 4 2.5 4H5"/>',
    bug: '<rect x="8" y="7" width="8" height="13" rx="4"/><path d="M12 7V4M8 11H4M20 11h-4M8 16H4M20 16h-4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    pin: '<path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/>',
    slash: '<path d="M16 4L8 20"/>',
    queue: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="M17 15l3 3-3 3"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  };

  /** Icon at top-left (x, y) scaled to `size`. */
  function ic(name, x, y, size = 16, color = C.ink2, sw = 1.8) {
    const k = size / 24;
    const body = ICONS[name] || ICONS.dots;
    const filled = name === 'stop' || name === 'play';
    // Stroke width is given in screen pixels, so divide by the scale.
    return `<g transform="translate(${x},${y}) scale(${k})" fill="${filled ? color : 'none'}" stroke="${color}" stroke-width="${(sw / k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
  }

  // ---------------------------------------------------------- components
  const BTN = {
    primary: { fill: C.accent, stroke: C.accent, ink: C.accentInk },
    secondary: { fill: C.surface, stroke: C.borderStrong, ink: C.ink },
    ghost: { fill: 'none', stroke: undefined, ink: C.ink2 },
    danger: { fill: C.crit, stroke: C.crit, ink: '#ffffff' },
    dangerOutline: { fill: C.surface, stroke: '#e9a3a3', ink: C.crit },
    soft: { fill: C.accentSoft, stroke: C.accentSoft, ink: C.accent },
    good: { fill: C.good, stroke: C.good, ink: '#ffffff' },
  };

  function btnW(label, o = {}) {
    const size = o.s ?? 13;
    return o.w ?? Math.round((label ? tw(label, size) : 0) + (o.icon ? (label ? 22 : 14) : 0) + (label ? 24 : 16));
  }

  /** Button; returns markup. o: v=variant, h=height, icon, w, s=font size, kbd */
  function btn(x, y, label, o = {}) {
    const v = BTN[o.v ?? 'secondary'];
    const h = o.h ?? 30;
    const size = o.s ?? 13;
    const w = btnW(label, o);
    let out = rect(x, y, w, h, { r: 6, fill: v.fill, stroke: v.stroke });
    let cx = x + (label ? 12 : (w - 16) / 2);
    if (o.icon) {
      out += ic(o.icon, cx, y + (h - 16) / 2, 16, v.ink);
      cx += 22;
    }
    if (label) {
      const tx = o.icon ? cx : x + w / 2;
      out += t(tx, y + h / 2 + size * 0.36, label, { s: size, w: 500, c: v.ink, a: o.icon ? undefined : 'middle' });
    }
    if (o.focus) out += rect(x - 3, y - 3, w + 6, h + 6, { r: 8, stroke: C.accentLine, sw: 2 });
    return out;
  }

  /** Pill chip. o: c=ink, bg, bd, h, s, icon, dot */
  function chip(x, y, label, o = {}) {
    const size = o.s ?? 11;
    const h = o.h ?? 20;
    const pad = 8;
    const extra = (o.icon ? 16 : 0) + (o.dot ? 12 : 0);
    const w = o.w ?? Math.round(tw(label, size, o.m) + pad * 2 + extra);
    let out = rect(x, y, w, h, { r: h / 2, fill: o.bg ?? C.surface3, stroke: o.bd });
    let cx = x + pad;
    if (o.dot) {
      out += circle(cx + 3, y + h / 2, 3.5, { fill: o.dot });
      cx += 12;
    }
    if (o.icon) {
      out += ic(o.icon, cx - 2, y + (h - 13) / 2, 13, o.c ?? C.ink2);
      cx += 16;
    }
    out += t(cx, y + h / 2 + size * 0.36, label, { s: size, w: o.w8 ?? 500, c: o.c ?? C.ink2, m: o.m });
    return out;
  }
  chip.w = (label, o = {}) => Math.round(tw(label, o.s ?? 11, o.m) + 16 + (o.icon ? 16 : 0) + (o.dot ? 12 : 0));

  /** Status chip with icon + label (status colors never carry meaning alone). */
  function status(x, y, kind, label) {
    const map = {
      good: { c: C.goodInk, bg: C.goodSoft, icon: 'check' },
      warn: { c: C.warnInk, bg: C.warnSoft, icon: 'warning' },
      crit: { c: C.crit, bg: C.critSoft, icon: 'x' },
      info: { c: C.accent, bg: C.accentSoft, icon: 'info' },
      idle: { c: C.ink2, bg: C.surface3, icon: 'clock' },
    };
    const m = map[kind];
    return chip(x, y, label, { c: m.c, bg: m.bg, icon: m.icon });
  }

  /** Text input. o: h, ph, val, label, icon, mono, focus, right (text at right) */
  function input(x, y, w, o = {}) {
    const h = o.h ?? 32;
    let out = '';
    if (o.label) out += t(x, y - 7, o.label, { s: 12, w: 500, c: C.ink2 });
    out += rect(x, y, w, h, { r: 6, fill: o.disabled ? C.surface2 : C.surface, stroke: o.focus ? C.accent : C.borderStrong, sw: o.focus ? 1.5 : 1 });
    let tx = x + 10;
    if (o.icon) {
      out += ic(o.icon, x + 9, y + (h - 16) / 2, 16, C.muted);
      tx += 22;
    }
    const ty = y + h / 2 + 4.5;
    if (o.val !== undefined) out += t(tx, ty, o.val, { s: o.s ?? 13, m: o.mono, c: C.ink });
    else if (o.ph) out += t(tx, ty, o.ph, { s: o.s ?? 13, c: C.muted, m: o.mono });
    if (o.focus && o.val !== undefined) {
      const cx = tx + tw(o.val, o.s ?? 13, o.mono) + 2;
      out += line(cx, y + 8, cx, y + h - 8, { c: C.ink, sw: 1.2 });
    }
    if (o.right) out += t(x + w - 10, ty, o.right, { s: 12, c: C.muted, a: 'end' });
    if (o.focus) out += rect(x - 3, y - 3, w + 6, h + 6, { r: 8, stroke: C.accentLine, sw: 2 });
    return out;
  }

  function select(x, y, w, val, o = {}) {
    return input(x, y, w, { ...o, val }) + ic('chevDown', x + w - 24, y + ((o.h ?? 32) - 16) / 2, 16, C.ink2);
  }

  function textarea(x, y, w, h, lines, o = {}) {
    let out = '';
    if (o.label) out += t(x, y - 7, o.label, { s: 12, w: 500, c: C.ink2 });
    out += rect(x, y, w, h, { r: 6, fill: C.surface, stroke: o.focus ? C.accent : C.borderStrong, sw: o.focus ? 1.5 : 1 });
    lines.forEach((ln, i) => {
      out += t(x + 10, y + 20 + i * 18, ln, { s: o.s ?? 12.5, m: o.mono, c: o.ph ? C.muted : C.ink });
    });
    return out;
  }

  function toggle(x, y, on, label, o = {}) {
    let out = rect(x, y, 32, 18, { r: 9, fill: on ? C.accent : C.borderStrong });
    out += circle(on ? x + 23 : x + 9, y + 9, 7, { fill: '#fff' });
    if (label) out += t(x + 42, y + 13.5, label, { s: o.s ?? 13, c: C.ink });
    if (o.hint) out += t(x + 42 + tw(label, o.s ?? 13) + 8, y + 13.5, o.hint, { s: 12, c: C.muted });
    return out;
  }

  function check(x, y, on, label, o = {}) {
    let out = rect(x, y, 16, 16, { r: 4, fill: on ? C.accent : C.surface, stroke: on ? C.accent : C.borderStrong });
    if (on) out += ic('check', x + 1, y + 1, 14, '#fff', 2.4);
    if (label) out += t(x + 24, y + 12.5, label, { s: o.s ?? 13, c: o.c ?? C.ink });
    return out;
  }

  function radio(x, y, on, label, o = {}) {
    let out = circle(x + 8, y + 8, 7.5, { fill: C.surface, stroke: on ? C.accent : C.borderStrong, sw: on ? 1.5 : 1 });
    if (on) out += circle(x + 8, y + 8, 4, { fill: C.accent });
    if (label) out += t(x + 24, y + 12.5, label, { s: o.s ?? 13, c: C.ink, w: o.w });
    return out;
  }

  /** Card / panel. o: title, sub, shadow, fill, head (header height), r */
  function panel(x, y, w, h, o = {}) {
    let out = rect(x, y, w, h, { r: o.r ?? 8, fill: o.fill ?? C.surface, stroke: o.stroke ?? C.border, shadow: o.shadow });
    if (o.title) {
      out += t(x + 14, y + 24, o.title, { s: o.ts ?? 14, w: 600 });
      if (o.sub) out += t(x + 14 + tw(o.title, o.ts ?? 14, false, true) + 14, y + 24, o.sub, { s: 12, c: C.muted });
      if (o.head !== false) out += line(x, y + 38, x + w, y + 38);
    }
    return out;
  }

  function hline(x, y, w, c = C.border) {
    return line(x, y, x + w, y, { c });
  }
  function vline(x, y, h, c = C.border) {
    return line(x, y, x, y + h, { c });
  }

  /** Numbered annotation marker. */
  function mk(x, y, n) {
    return `<g class="mk" data-n="${n}" style="cursor:pointer">` +
      circle(x, y, 11.5, { fill: '#ffffff' }) + circle(x, y, 10, { fill: C.marker }) +
      `<text x="${x}" y="${y + 4}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle" font-family="${FONT}">${n}</text></g>`;
  }

  /** Code block: lines are strings or arrays of [text, color, weight] runs. */
  function code(x, y, w, lines, o = {}) {
    const lh = o.lh ?? 17;
    const h = o.h ?? lines.length * lh + 16;
    let out = rect(x, y, w, h, { r: 6, fill: o.bg ?? C.codeBg, stroke: o.stroke ?? C.border });
    lines.forEach((ln, i) => {
      const yy = y + 14 + i * lh + 4;
      out += Array.isArray(ln) ? runs(x + 10, yy, ln, { s: o.s ?? 12, m: true }) : t(x + 10, yy, ln, { s: o.s ?? 12, m: true, c: o.c ?? C.ink });
    });
    return out;
  }

  /** Diff block: lines starting with '+', '-', '@' or ' '. */
  function diff(x, y, w, lines, o = {}) {
    const lh = o.lh ?? 18;
    let out = rect(x, y, w, lines.length * lh + 8, { r: 6, fill: C.surface, stroke: C.border });
    lines.forEach((ln, i) => {
      const yy = y + 4 + i * lh;
      const k = ln[0];
      if (k === '+') out += rect(x + 1, yy, w - 2, lh, { fill: C.addBg });
      if (k === '-') out += rect(x + 1, yy, w - 2, lh, { fill: C.delBg });
      if (k === '@') out += rect(x + 1, yy, w - 2, lh, { fill: C.accentSoft });
      const c = k === '+' ? C.addInk : k === '-' ? C.delInk : k === '@' ? C.accent : C.ink2;
      out += t(x + 10, yy + 13, ln, { s: 12, m: true, c });
    });
    return out;
  }

  function overlay(w = 1440, h = 900) {
    return rect(0, 0, w, h, { fill: C.overlay });
  }

  function dot(x, y, c, r = 4) {
    return circle(x, y, r, { fill: c });
  }

  function avatar(x, y, letter, c = C.accent, r = 14) {
    return circle(x + r, y + r, r, { fill: c }) + t(x + r, y + r + 4.5, letter, { s: 12, w: 600, c: '#fff', a: 'middle' });
  }

  /** Underline tabs. items: labels or [label, count]. returns markup */
  function tabs(x, y, items, active, o = {}) {
    let out = '';
    let cx = x;
    const size = o.s ?? 13;
    items.forEach((it, i) => {
      const [label, count] = Array.isArray(it) ? it : [it];
      const w = tw(label, size) + (count !== undefined ? tw(String(count), 11) + 16 : 0);
      const on = i === active;
      out += t(cx, y, label, { s: size, w: on ? 600 : 500, c: on ? C.ink : C.ink2 });
      if (count !== undefined) out += chip(cx + tw(label, size) + 6, y - 13, String(count), { h: 16, s: 10, bg: on ? C.accentSoft : C.surface3, c: on ? C.accent : C.ink2 });
      if (on) out += rect(cx, y + 9, w, 2, { fill: C.accent, r: 1 });
      cx += w + (o.gap ?? 22);
    });
    if (o.rule) out += hline(o.rule[0], y + 11, o.rule[1]);
    return out;
  }

  /** Segmented control. */
  function seg(x, y, items, active, o = {}) {
    const h = o.h ?? 28;
    const size = o.s ?? 12;
    const ws = items.map((s) => Math.round(tw(s, size) + 22));
    const total = ws.reduce((a, b) => a + b, 0) + 4;
    let out = rect(x, y, total, h, { r: 7, fill: C.surface3 });
    let cx = x + 2;
    items.forEach((s, i) => {
      if (i === active) out += rect(cx, y + 2, ws[i], h - 4, { r: 5, fill: C.surface, stroke: C.border });
      out += t(cx + ws[i] / 2, y + h / 2 + 4, s, { s: size, w: i === active ? 600 : 500, c: i === active ? C.ink : C.ink2, a: 'middle' });
      cx += ws[i];
    });
    return out;
  }
  seg.w = (items, size = 12) => items.reduce((a, s) => a + Math.round(tw(s, size) + 22), 0) + 4;

  function progress(x, y, w, pct, c = C.accent, h = 6) {
    return rect(x, y, w, h, { r: h / 2, fill: C.surface3 }) + rect(x, y, Math.max(h, (w * pct) / 100), h, { r: h / 2, fill: c });
  }

  function kbd(x, y, label) {
    const w = Math.max(18, tw(label, 10.5) + 10);
    return rect(x, y, w, 18, { r: 4, fill: C.surface, stroke: C.borderStrong }) + t(x + w / 2, y + 12.5, label, { s: 10.5, c: C.ink2, a: 'middle', w: 500 });
  }
  kbd.w = (label) => Math.max(18, tw(label, 10.5) + 10);

  /** Diagram box for flow / architecture charts. */
  function box(x, y, w, h, title, sub, o = {}) {
    let out = rect(x, y, w, h, { r: 8, fill: o.fill ?? C.surface, stroke: o.stroke ?? C.borderStrong, sw: o.sw ?? 1, shadow: o.shadow });
    const subs = sub ? (Array.isArray(sub) ? sub : [sub]) : [];
    // Vertically centre the title plus its sub lines as one block.
    const top = y + (h - (16 + subs.length * 15)) / 2 + 12;
    out += t(x + w / 2, top, title, { s: o.s ?? 13, w: 600, a: 'middle', c: o.ink ?? C.ink });
    subs.forEach((s, i) => (out += t(x + w / 2, top + 17 + i * 15, s, { s: 11, c: o.subInk ?? C.ink2, a: 'middle' })));
    return out;
  }

  function arrow(x1, y1, x2, y2, o = {}) {
    return line(x1, y1, x2, y2, { c: o.c ?? C.ink2, sw: o.sw ?? 1.4, arrow: true, dash: o.dash });
  }

  /** Small menu item row (used in dropdowns / palettes). */
  function menuItem(x, y, w, label, o = {}) {
    let out = '';
    if (o.active) out += rect(x + 4, y, w - 8, 30, { r: 5, fill: C.accentSoft });
    let cx = x + 12;
    if (o.icon) {
      out += ic(o.icon, cx, y + 7, 16, o.active ? C.accent : C.ink2);
      cx += 24;
    }
    out += t(cx, y + 19.5, label, { s: 13, w: o.active ? 600 : 400, c: o.c ?? C.ink, m: o.m });
    if (o.hint) out += t(cx + tw(label, 13, o.m) + 10, y + 19.5, o.hint, { s: 12, c: C.muted });
    if (o.right) out += t(x + w - 12, y + 19.5, o.right, { s: 11.5, c: C.muted, a: 'end' });
    return out;
  }

  // ------------------------------------------------------------ app shell
  const NAV = [
    ['sessions', 'chat', 'Sessions'],
    ['agents', 'agent', 'Agents'],
    ['mcp', 'plug', 'MCP'],
    ['skills', 'spark', 'Skills'],
    ['hooks', 'hook', 'Hooks'],
    ['jobs', 'braces', 'Jobs'],
    ['usage', 'chart', 'Usage'],
    ['settings', 'gear', 'Settings'],
  ];

  /** Page background, top bar and nav rail. o: nav, approvals, workspace */
  function shell(o = {}) {
    let out = rect(0, 0, 1440, 900, { fill: C.page });
    // top bar
    out += rect(0, 0, 1440, 48, { fill: C.surface }) + hline(0, 48, 1440);
    out += rect(16, 12, 24, 24, { r: 6, fill: C.ink });
    out += path('M22 24l5-6M22 24l5 6M33 18v12', { c: '#fff', sw: 2 });
    out += t(50, 29.5, 'Code Agent', { s: 15, w: 700 });
    out += t(150, 29.5, 'Powered by Claude', { s: 11, c: C.muted });
    // workspace switcher
    out += rect(258, 9, 230, 30, { r: 6, fill: C.surface2, stroke: C.border });
    out += ic('folder', 268, 16, 16, C.ink2);
    out += t(292, 28.5, o.workspace ?? 'D:\\src\\shop-api', { s: 13, w: 500, m: false });
    out += ic('chevDown', 462, 16, 16, C.ink2);
    // command search
    out += rect(560, 9, 360, 30, { r: 6, fill: C.surface2, stroke: C.border });
    out += ic('search', 571, 16, 16, C.muted);
    out += t(595, 28.5, 'Search sessions, commands, settings…', { s: 13, c: C.muted });
    out += kbd(880, 15, 'Ctrl K');
    // right side
    out += rect(1150, 11, 108, 26, { r: 13, fill: C.surface2, stroke: C.border });
    out += dot(1164, 24, C.good, 4);
    out += t(1174, 28.5, 'Warm pool 1', { s: 12, c: C.ink2 });
    out += ic('bell', 1278, 13, 22, C.ink2);
    const ap = o.approvals ?? 0;
    if (ap) {
      out += circle(1297, 15, 8, { fill: C.crit });
      out += t(1297, 19, String(ap), { s: 10.5, w: 700, c: '#fff', a: 'middle' });
    }
    out += avatar(1318, 10, 'M', '#52514e');
    out += t(1352, 22, 'API key', { s: 11, c: C.muted });
    out += t(1352, 36, 'Anthropic', { s: 11, c: C.ink2, w: 500 });
    // nav rail
    out += rect(0, 49, 64, 851, { fill: C.surface }) + vline(64, 49, 851);
    NAV.forEach(([id, icon, label], i) => {
      const y = 62 + i * 62;
      const on = id === o.nav;
      if (on) out += rect(8, y, 48, 52, { r: 8, fill: C.accentSoft });
      out += ic(icon, 21, y + 8, 22, on ? C.accent : C.ink2);
      out += t(32, y + 44, label, { s: 10.5, w: on ? 600 : 500, c: on ? C.accent : C.ink2, a: 'middle' });
    });
    out += ic('moon', 21, 846, 20, C.muted);
    return out;
  }

  /** Session list column (live + recent) used by live-session screens. */
  function sessionColumn(o = {}) {
    const x = 65;
    const w = 239;
    let out = rect(x, 49, w, 851, { fill: C.surface2 }) + vline(x + w, 49, 851);
    out += btn(x + 12, 62, 'New session', { v: 'primary', icon: 'plus', w: w - 24 - 38 });
    out += btn(x + w - 46, 62, '', { icon: 'filter', w: 34 });
    out += t(x + 14, 122, 'LIVE', { s: 11, w: 600, c: C.muted, ls: 0.6 });
    const live = o.live ?? [
      ['Fix flaky checkout tests', 'requires_action', 'shop-api'],
      ['Refactor auth middleware', 'running', 'shop-api'],
      ['Docs: API reference', 'idle', 'shop-web'],
    ];
    live.forEach(([title, st, ws, note], i) => {
      const y = 132 + i * 54;
      const on = i === (o.active ?? 0);
      if (on) out += rect(x + 6, y, w - 12, 48, { r: 7, fill: C.surface, stroke: C.border });
      const sc = st === 'running' ? C.accent : st === 'requires_action' ? C.warn : C.muted;
      out += circle(x + 20, y + 17, 4.5, { fill: sc });
      if (st === 'running') out += circle(x + 20, y + 17, 7.5, { stroke: C.accentLine, sw: 1.5 });
      out += t(x + 32, y + 21, title, { s: 13, w: on ? 600 : 500 });
      const label = note ?? (st === 'requires_action' ? 'Needs approval' : st === 'running' ? 'Running · 2m 14s' : 'Idle');
      out += t(x + 32, y + 38, `${ws} · ${label}`, { s: 11.5, c: st === 'requires_action' ? C.warnInk : C.muted });
    });
    const ry = 132 + live.length * 54 + 18;
    out += t(x + 14, ry, 'RECENT', { s: 11, w: 600, c: C.muted, ls: 0.6 });
    const recent = o.recent ?? [
      ['Add rate limiting to /orders', '2h ago', 'perf'],
      ['Investigate memory leak', 'Yesterday', null],
      ['Migrate to Postgres 17', 'Mon', 'db'],
      ['Write release notes 3.2', 'Oct 21', null],
      ['Review PR #482', 'Oct 20', 'review'],
    ];
    recent.forEach(([title, when, tag], i) => {
      const y = ry + 12 + i * 44;
      out += t(x + 14, y + 16, title, { s: 12.5, c: C.ink });
      out += t(x + 14, y + 32, when, { s: 11, c: C.muted });
      if (tag) out += chip(x + 14 + tw(when, 11) + 8, y + 21, tag, { h: 15, s: 10 });
    });
    out += t(x + 14, 884, 'All sessions →', { s: 12, w: 500, c: C.accent });
    return out;
  }

  /** Live session header row. */
  function sessionHeader(x, y, w, o = {}) {
    let out = rect(x, y, w, 56, { fill: C.surface }) + hline(x, y + 56, w);
    out += t(x + 20, y + 24, o.title ?? 'Fix flaky checkout tests', { s: 15, w: 600 });
    out += ic('pencil', x + 20 + tw(o.title ?? 'Fix flaky checkout tests', 15, false, true) + 8, y + 12, 14, C.muted);
    const st = o.state ?? 'running';
    const stl = { running: ['info', 'Running'], requires_action: ['warn', 'Needs your input'], idle: ['idle', 'Idle'] }[st];
    out += status(x + 20, y + 32, stl[0], stl[1]);
    out += t(x + 20 + chip.w(stl[1], { icon: 1 }) + 10, y + 46, o.sub ?? 'shop-api · main', { s: 11.5, c: C.muted });
    // controls at right
    // Controls, right to left: stop · cost · context · permission mode · model + effort
    let rx = x + w - 16 - 32;
    let out2 = btn(rx, y + 13, '', { v: 'dangerOutline', icon: 'stop', w: 32 });
    rx -= 80;
    out2 += rect(rx, y + 13, 72, 30, { r: 6, fill: C.surface2, stroke: C.border });
    out2 += t(rx + 9, y + 25, o.budget ?? 'Cost · cap $5', { s: 10, c: C.muted });
    out2 += t(rx + 9, y + 38.5, o.cost ?? '$0.42', { s: 12.5, w: 600 });
    rx -= 104;
    const pct = o.ctx ?? 38;
    out2 += rect(rx, y + 13, 96, 30, { r: 6, fill: C.surface2, stroke: C.border });
    out2 += t(rx + 9, y + 25, 'Context', { s: 10, c: C.muted });
    out2 += t(rx + 87, y + 25, pct + '%', { s: 10, w: 600, a: 'end', c: pct > 80 ? C.crit : C.ink2 });
    out2 += progress(rx + 9, y + 32, 78, pct, pct > 80 ? C.crit : pct > 60 ? C.warn : C.accent, 5);
    rx -= 160;
    out2 += rect(rx, y + 13, 152, 30, { r: 6, fill: o.modeBg ?? C.surface, stroke: o.modeStroke ?? C.borderStrong });
    out2 += ic(o.modeIcon ?? 'shield', rx + 8, y + 20, 16, o.modeInk ?? C.ink2);
    out2 += t(rx + 30, y + 32.5, o.mode ?? 'Ask before edits', { s: 12.5, w: 500, c: o.modeInk ?? C.ink });
    out2 += ic('chevDown', rx + 130, y + 20, 16, C.ink2);
    rx -= 160;
    out2 += rect(rx, y + 13, 152, 30, { r: 6, fill: C.surface, stroke: C.borderStrong });
    out2 += ic('cpu', rx + 8, y + 20, 16, C.ink2);
    out2 += t(rx + 30, y + 32.5, o.model ?? 'Opus 5.5 · high', { s: 12.5, w: 500 });
    out2 += ic('chevDown', rx + 130, y + 20, 16, C.ink2);
    return out + out2;
  }

  /** Composer at the bottom of the transcript. */
  function composer(x, y, w, o = {}) {
    const h = o.h ?? 112;
    let out = rect(x, y, w, h, { r: 10, fill: C.surface, stroke: o.focus ? C.accent : C.borderStrong, sw: o.focus ? 1.5 : 1, shadow: true });
    const text = o.text;
    if (text) {
      out += t(x + 16, y + 28, text, { s: 14 });
      if (o.focus) {
        const cx = x + 16 + tw(text, 14) + 2;
        out += line(cx, y + 15, cx, y + 33, { c: C.ink, sw: 1.3 });
      }
      if (o.ghost) out += t(x + 16 + tw(text, 14) + 4, y + 28, o.ghost, { s: 14, c: C.muted });
    } else {
      out += t(x + 16, y + 28, o.ph ?? 'Ask, or type / for commands and @ to mention files', { s: 14, c: C.muted });
    }
    const by = y + h - 40;
    out += btn(x + 10, by, '', { v: 'ghost', icon: 'clip', w: 32 });
    out += btn(x + 44, by, '', { v: 'ghost', icon: 'image', w: 32 });
    out += btn(x + 78, by, '', { v: 'ghost', icon: 'at', w: 32 });
    out += btn(x + 112, by, '', { v: 'ghost', icon: 'slash', w: 32 });
    out += vline(x + 152, by + 6, 20);
    out += t(x + 164, by + 20, o.hint ?? 'Enter to send · Shift+Enter newline', { s: 11.5, c: C.muted });
    if (o.running) {
      out += btn(x + w - 214, by, 'Queue', { v: 'secondary', icon: 'queue', w: 92 });
      out += btn(x + w - 114, by, 'Interrupt', { v: 'dangerOutline', icon: 'stop', w: 102 });
    } else {
      out += btn(x + w - 92, by, 'Send', { v: 'primary', icon: 'send', w: 80 });
    }
    return out;
  }

  // Live session layout: session column | transcript | inspector
  const L = { MX: 305, MW: 795, TX: 329, TW: 747, IX: 1101, IW: 339, CY: 776 };

  /** Inspector column with tabs. tab = index into INSPECTOR_TABS. */
  const INSPECTOR_TABS = ['Tasks', 'Background', 'Changes', 'Checkpoints', 'Context'];
  function inspector(tab, o = {}) {
    let out = rect(L.IX, 49, L.IW, 851, { fill: C.surface }) + vline(L.IX, 49, 851);
    out += t(L.IX + 16, 76, o.title ?? 'Inspector', { s: 12, w: 600, c: C.muted, ls: 0.4 });
    out += ic('dots', L.IX + L.IW - 34, 64, 18, C.ink2);
    out += ic('expand', L.IX + L.IW - 62, 65, 16, C.ink2);
    out += tabs(L.IX + 16, 112, o.tabs ?? INSPECTOR_TABS, tab, { s: 12, gap: 12 });
    out += hline(L.IX, 123, L.IW);
    return out;
  }

  /** Tool call card. o: icon, name, detail, right, st ('ok'|'run'|'err'|'wait'|'deny'), body, bodyH, prov */
  function toolCard(x, y, w, o = {}) {
    const bodyH = o.body ? (o.bodyH ?? 80) : 0;
    const h = 38 + bodyH;
    let out = rect(x, y, w, h, { r: 8, fill: C.surface, stroke: o.st === 'wait' ? C.warn : C.border, sw: o.st === 'wait' ? 1.5 : 1 });
    out += rect(x + 1, y + 1, w - 2, 36, { r: 7, fill: C.surface2 });
    out += ic(o.icon ?? 'terminal', x + 12, y + 11, 16, C.ink2);
    out += t(x + 36, y + 23.5, o.name ?? 'Bash', { s: 12.5, w: 600 });
    const nx = x + 36 + tw(o.name ?? 'Bash', 12.5) + 10;
    if (o.detail) out += t(nx, y + 23.5, o.detail, { s: 12, m: true, c: C.ink2 });
    let rx = x + w - 12;
    if (o.right) {
      out += t(rx, y + 23.5, o.right, { s: 11.5, c: C.muted, a: 'end' });
      rx -= tw(o.right, 11.5) + 10;
    }
    const st = o.st ?? 'ok';
    const stIcon = { ok: ['check', C.goodInk], run: ['clock', C.accent], err: ['x', C.crit], wait: ['warning', C.warnInk], deny: ['x', C.crit] }[st];
    out += ic(stIcon[0], rx - 16, y + 11, 16, stIcon[1], 2);
    if (o.prov) out += chip(rx - 26 - chip.w(o.prov, { icon: 1 }), y + 9, o.prov, { icon: 'shield', h: 20 });
    if (o.body) out += hline(x, y + 37, w) + o.body;
    return out;
  }

  /** User message block. */
  function userMsg(x, y, w, text, o = {}) {
    const lines = wrap(text, w - 64, 14);
    const h = 24 + lines.length * 21 + (o.attach ? 34 : 0);
    let out = rect(x, y, w, h, { r: 10, fill: C.accentSoft });
    out += avatar(x + 10, y + 10, 'M', '#52514e', 12);
    lines.forEach((ln, i) => (out += t(x + 44, y + 27 + i * 21, ln, { s: 14 })));
    if (o.attach) out += chip(x + 44, y + 22 + lines.length * 21, o.attach, { icon: 'image', h: 22, bg: C.surface });
    if (o.hover) {
      out += btn(x + w - 214, y - 14, 'Rewind', { icon: 'rewind', h: 26, s: 12 });
      out += btn(x + w - 120, y - 14, 'Branch', { icon: 'branch', h: 26, s: 12 });
    }
    return out;
  }

  /** Collapsible thinking block. */
  function thinking(x, y, w, o = {}) {
    let out = rect(x, y, w, 32, { r: 6, fill: C.surface2, stroke: C.border, dash: '3 3' });
    out += ic(o.open ? 'chevDown' : 'chevRight', x + 8, y + 8, 16, C.muted);
    out += ic('bulb', x + 28, y + 8, 16, C.muted);
    out += t(x + 50, y + 20.5, `Thinking · ${o.dur ?? '6s'}`, { s: 12, w: 600, c: C.ink2 });
    out += t(x + 50 + tw(`Thinking · ${o.dur ?? '6s'}`, 12) + 12, y + 20.5, o.preview ?? '', { s: 12, i: true, c: C.muted });
    return out;
  }

  /** Small labelled key/value row. */
  function kv(x, y, k, v, o = {}) {
    return t(x, y, k, { s: 12, c: C.muted }) + t(x + (o.kw ?? 110), y, v, { s: 12, c: C.ink, m: o.m, w: o.w });
  }

  /** Defs shared by every screen. */
  function defs() {
    return `<defs>
      <filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#0f172a" flood-opacity="0.10"/></filter>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.ink2}"/></marker>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${C.surface3}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${C.borderStrong}" stroke-width="2"/></pattern>
    </defs>`;
  }

  function svg(body, w = 1440, h = 900) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}">${defs()}${body}</svg>`;
  }

  window.K = {
    C, FONT, MONO, esc, tw, wrap, rect, line, path, circle, t, runs, para, ic, btn, btnW, chip, status,
    input, select, textarea, toggle, check, radio, panel, hline, vline, mk, code, diff, overlay, dot,
    avatar, tabs, seg, progress, kbd, box, arrow, menuItem, shell, sessionColumn, sessionHeader,
    composer, svg, L, inspector, toolCard, userMsg, thinking, kv,
  };
  window.SCREENS = window.SCREENS || [];
})();
