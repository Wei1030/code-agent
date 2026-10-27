/* Renders the screens registered in window.SCREENS into the page. */
(function () {
  'use strict';

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Notes use `code` spans; everything else is plain text.
  const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

  const host = document.getElementById('screens');
  const toc = document.getElementById('toc-links');
  let lastGroup = null;

  // Keep each group's screens together, groups in order of first appearance.
  const groups = [...new Set(window.SCREENS.map((s) => s.group))];
  const ordered = [...window.SCREENS].sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group));

  for (const s of ordered) {
    const svgMarkup = window.K.svg(s.draw(), s.w ?? 1440, s.h ?? 900);
    const sec = document.createElement('section');
    sec.className = 'screen';
    sec.id = s.id;
    sec.innerHTML = `
      <div class="screen-head">
        <span class="sid">${s.id}</span>
        <h2>${esc(s.title)}</h2>
        <span class="group">${esc(s.group)}</span>
        <div class="tools">
          <button data-act="open">Open SVG</button>
          <button data-act="download">Download SVG</button>
        </div>
      </div>
      <p class="summary">${rich(s.summary)}</p>
      <p class="frs">Requirements: ${s.frs.map((f) => `<code>${esc(f)}</code>`).join(' ')}</p>
      <figure class="canvas">${svgMarkup}</figure>
      <table class="notes">
        <thead><tr><th>#</th><th>Element</th><th>Interaction</th><th>Behaviour · SDK</th></tr></thead>
        <tbody>${s.notes
          .map(([el, how, sdk], i) => `<tr data-n="${i + 1}"><td><span class="num">${i + 1}</span></td><td class="el">${rich(el)}</td><td>${rich(how)}</td><td class="sdk">${rich(sdk)}</td></tr>`)
          .join('')}</tbody>
      </table>`;
    host.appendChild(sec);

    if (s.group !== lastGroup) {
      const g = document.createElement('div');
      g.className = 'group';
      g.textContent = s.group;
      toc.appendChild(g);
      lastGroup = s.group;
    }
    const a = document.createElement('a');
    a.href = `#${s.id}`;
    a.innerHTML = `<span class="sid">${s.id}</span>${esc(s.title)}`;
    toc.appendChild(a);

    wire(sec, svgMarkup, s);
  }

  function wire(sec, svgMarkup, s) {
    const rows = sec.querySelectorAll('tbody tr');
    const marks = sec.querySelectorAll('.mk');
    const hot = (n, on) => {
      sec.querySelectorAll(`.mk[data-n="${n}"]`).forEach((m) => m.classList.toggle('hot', on));
      sec.querySelectorAll(`tr[data-n="${n}"]`).forEach((r) => r.classList.toggle('hot', on));
    };
    rows.forEach((r) => {
      r.addEventListener('mouseenter', () => hot(r.dataset.n, true));
      r.addEventListener('mouseleave', () => hot(r.dataset.n, false));
    });
    marks.forEach((m) => {
      m.addEventListener('mouseenter', () => hot(m.dataset.n, true));
      m.addEventListener('mouseleave', () => hot(m.dataset.n, false));
      m.addEventListener('click', () => {
        const row = sec.querySelector(`tr[data-n="${m.dataset.n}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    const blob = () => new Blob([svgMarkup], { type: 'image/svg+xml' });
    sec.querySelector('[data-act="open"]').addEventListener('click', () => {
      window.open(URL.createObjectURL(blob()), '_blank');
    });
    sec.querySelector('[data-act="download"]').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob());
      a.download = `${s.id}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`;
      a.click();
    });
  }

  document.getElementById('toggle-markers').addEventListener('change', (e) => {
    document.body.classList.toggle('no-markers', !e.target.checked);
  });

  // Highlight the TOC entry of the screen in view.
  const links = [...toc.querySelectorAll('a')];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === `#${en.target.id}`));
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('section.screen, section.doc').forEach((s) => io.observe(s));
})();
