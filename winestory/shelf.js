// Shelf + cellar: lays bottles out in overlapping rows, newest first and in front.
(async function () {
  const root = document.getElementById('shelf');
  const q = document.getElementById('q');
  const count = document.getElementById('count');
  const mode = document.body.dataset.mode; // 'shelf' | 'cellar'

  let wines;
  try { wines = await loadWines(); }
  catch (e) { root.innerHTML = '<div class="empty">couldn\'t load the shelf</div>'; return; }

  // ?demo=14 fills the shelf with copies so you can see the overlap and wrapping.
  const demo = parseInt(new URLSearchParams(location.search).get('demo'), 10);
  if (demo > 0 && wines.length) {
    const base = wines.slice();
    wines = Array.from({ length: demo }, (_, i) => {
      const b = base[i % base.length];
      return { ...b, link: b.slug, slug: `${b.slug}-demo${i}`, heightCm: [29, 30, 31, 32, 33, 35][i % 6], cellar: true };
    });
  }

  if (mode === 'cellar') wines = wines.filter((w) => w.cellar);
  wines.sort((a, b) => (b.added || '').localeCompare(a.added || ''));

  if (!wines.length) {
    root.innerHTML = `<div class="empty">${mode === 'cellar' ? 'the cellar is empty' : 'nothing on the shelf yet'}</div>`;
    count.textContent = '';
    return;
  }

  // Need each PNG's aspect ratio to size bottles correctly.
  const aspects = await Promise.all(wines.map((w) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth / im.naturalHeight);
    im.onerror = () => res(0.23);
    im.src = w.image;
  })));

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const haystack = wines.map((w) => norm([
    w.producer, w.cuvee, w.vintage, w.country, w.region, w.style,
    ...(w.blend || []).map((b) => b.grape),
  ].join(' ')));

  function applyFilter() {
    const terms = norm(q.value).split(/\s+/).filter(Boolean);
    let hits = 0;
    root.querySelectorAll('.bottle').forEach((el) => {
      const ok = terms.every((t) => haystack[+el.dataset.i].includes(t));
      el.classList.toggle('dim', !ok);
      if (ok) hits++;
    });
    count.textContent = terms.length ? `${hits} of ${wines.length}` : `${wines.length} bottle${wines.length === 1 ? '' : 's'}`;
  }

  let lastW = 0;
  function render() {
    const W = root.clientWidth - 44; // minus the shelf's side padding
    lastW = root.clientWidth;
    // px per cm: real bottle heights stay proportional to each other.
    const pxPerCm = Math.max(3.2, Math.min(7.2, W / 108));

    const rows = [[]];
    let x = 0;
    wines.forEach((w, i) => {
      const h = (w.heightCm || 30) * pxPerCm;
      const wd = h * aspects[i];
      if (x > 0 && x + wd > W) { rows.push([]); x = 0; }
      rows[rows.length - 1].push({ w, i, h, wd, x });
      const overlap = -0.2 + seeded(w.slug, 1) * 0.55; // from a 20% gap to 35% overlap, so some bottles stand clear
      x += wd * (1 - overlap);
    });

    while (rows.length < 2) rows.push([]); // always at least two shelves
    root.innerHTML = '';
    rows.forEach((items) => {
      const rowH = 36 * pxPerCm + 56; // every compartment the same height
      const row = document.createElement('div');
      row.className = 'row';
      row.style.height = rowH + 'px';
      row.innerHTML = '<div class="board"></div>';
      items.forEach(({ w, i, h, wd, x }) => {
        const a = document.createElement('a');
        a.className = 'bottle';
        a.href = `wine.html?w=${encodeURIComponent(w.link || w.slug)}`;
        a.dataset.i = i;
        a.setAttribute('aria-label', wineTitle(w));
        // some bottles stand at the back of the board, some at the front
        const back = seeded(w.slug, 3) < 0.42;
        const z = (back ? 0 : 100) + Math.floor(seeded(w.slug, 4) * 90);
        a.style.cssText = `left:${x}px;width:${wd}px;height:${h}px;z-index:${z};--lift:${(back ? 34 : 17) + seeded(w.slug, 5) * 6}px;--shade:${back ? 0.8 : 1};--lean:${((seeded(w.slug, 2) - 0.5) * 3).toFixed(2)}deg`;
        a.innerHTML = `<img src="${esc(w.image)}" alt=""><img class="o" src="${esc(w.image)}" alt="" aria-hidden="true"><span class="tag">${esc(wineTitle(w))}</span>`;
        row.appendChild(a);
      });
      root.appendChild(row);
    });
    applyFilter();
  }

  q.addEventListener('input', applyFilter);
  new ResizeObserver(() => { if (Math.abs(root.clientWidth - lastW) > 1) render(); }).observe(root);
  render();
})();
