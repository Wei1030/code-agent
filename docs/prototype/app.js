/* Renders window.SCREENS (written by tools/shoot.ts) and window.NOTES (notes.js). */
(function () {
  'use strict';
  const W = 1440, H = 900;
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Notes use `code` spans and **bold**; everything else is plain text.
  const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const STATUS = { done: ['已实现', 'st-done'], new: ['提议', 'st-new'], changed: ['已实现 · 有提议', 'st-changed'] };

  const table = (head, rows) => `<table class="notes"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  document.getElementById('proposal-list').innerHTML = table(['', '功能', '在哪', '做什么', '需求', '工作量'], (window.PROPOSALS ?? []).map((p, i) =>
    `<tr><td><span class="num">${i + 1}</span></td><td class="el">${rich(p.name)}</td><td>${p.screens.map((s) => `<a href="#${s}">${s}</a>`).join(' ')}</td><td>${rich(p.what)}</td><td>${p.frs.map((f) => `<code>${esc(f)}</code>`).join(' ')}</td><td>${esc(p.size)}</td></tr>`));
  document.getElementById('left-out-list').innerHTML = table(['功能', '需求', '为什么不做'], (window.LEFT_OUT ?? []).map((p) =>
    `<tr><td class="el">${rich(p.name)}</td><td>${p.frs.map((f) => `<code>${esc(f)}</code>`).join(' ')}</td><td>${rich(p.why)}</td></tr>`));

  const host = document.getElementById('screens');
  const toc = document.getElementById('toc-links');
  let group = null;

  for (const s of window.SCREENS) {
    if (s.group !== group) {
      group = s.group;
      const g = document.createElement('div');
      g.className = 'group';
      g.textContent = group;
      toc.appendChild(g);
    }
    const [label, cls] = STATUS[s.status] ?? STATUS.done;
    const a = document.createElement('a');
    a.href = `#${s.id}`;
    a.innerHTML = `<span class="sid">${s.id}</span>${esc(s.title)}${s.status !== 'done' ? `<span class="dot ${cls}"></span>` : ''}`;
    toc.appendChild(a);

    const sec = document.createElement('section');
    sec.className = 'screen';
    sec.id = s.id;
    const marks = s.marks.map((m, i) => {
      if (!m.box) return '';
      const [x, y, w, h] = m.box;
      const left = (x / W) * 100, top = (y / H) * 100;
      return `<div class="mk${m.isNew ? ' mk-new' : ''}" data-n="${i + 1}" style="left:${left}%;top:${top}%">${i + 1}</div>
        <div class="hl" data-n="${i + 1}" style="left:${left}%;top:${top}%;width:${(w / W) * 100}%;height:${(h / H) * 100}%"></div>`;
    }).join('');
    sec.innerHTML = `
      <div class="screen-head">
        <span class="sid">${s.id}</span><h2>${esc(s.title)}</h2>
        <span class="badge ${cls}">${label}</span><span class="grp">${esc(s.group)}</span>
      </div>
      <p class="summary">${rich(s.summary)}</p>
      ${s.frs?.length ? `<p class="frs">对应需求：${s.frs.map((f) => `<code>${esc(f)}</code>`).join(' ')}</p>` : ''}
      ${s.error ? `<p class="err">截图失败：${esc(s.error)}</p>` : ''}
      <figure class="canvas"><img src="shots/${s.id}.webp" alt="${esc(s.title)}" loading="lazy">${marks}</figure>
      <table class="notes">
        <thead><tr><th>#</th><th>元素</th><th>交互</th><th>行为</th></tr></thead>
        <tbody>${s.marks.map((m, i) => `<tr data-n="${i + 1}" class="${m.isNew ? 'row-new' : ''}"><td><span class="num${m.isNew ? ' num-new' : ''}">${i + 1}</span></td><td class="el">${rich(m.note[0])}</td><td>${rich(m.note[1])}</td><td>${rich(m.note[2])}</td></tr>`).join('')}</tbody>
      </table>
      ${s.snippet ? `<details class="snippet"><summary>提议部分的界面片段（用应用现有的样式类写成，实现时可直接参考）</summary><pre><code>${esc(s.snippet)}</code></pre></details>` : ''}`;
    host.appendChild(sec);

    // Hovering a note row outlines its element on the screenshot, and the other way round.
    const light = (n, on) => {
      sec.querySelectorAll(`[data-n="${n}"]`).forEach((e) => e.classList.toggle('on', on));
    };
    sec.querySelectorAll('[data-n]').forEach((e) => {
      e.addEventListener('mouseenter', () => light(e.dataset.n, true));
      e.addEventListener('mouseleave', () => light(e.dataset.n, false));
      if (e.classList.contains('mk')) e.addEventListener('click', () => sec.querySelector(`tr[data-n="${e.dataset.n}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    });
  }

  document.getElementById('toggle-markers').addEventListener('change', (e) => document.body.classList.toggle('no-marks', !e.target.checked));
})();
