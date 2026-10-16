// A single wine: bottle + blend breakdown on the left, Jay's writing on the right.
// Writing lives in posts/<slug>.txt: blank-line separated paragraphs,
// "## " for headings, optional first line "# Title", *italic*, **bold**, [text](url).
(async function () {
  const root = document.getElementById('wine');
  const slug = new URLSearchParams(location.search).get('w');

  let wines;
  try { wines = await loadWines(); } catch (e) { root.textContent = 'could not load this wine'; return; }
  const w = wines.find((x) => x.slug === slug);
  if (!w) { root.innerHTML = '<div class="info"><h1>not on the shelf</h1><p class="meta"><a href="./">back to the shelf</a></p></div>'; return; }

  document.title = wineTitle(w);

  const TINTS = ['#e8c15a', '#d9715f', '#86b86a', '#6aa8d8', '#b68ad8'];
  const fill = w.fill || 0.88; // how far up the bottle the liquid reaches
  const blend = (w.blend || []).slice();
  const total = blend.reduce((s, b) => s + b.pct, 0) || 100;

  let cum = 0;
  const bands = [], keys = [];
  blend.forEach((b, i) => {
    const from = (cum / total) * fill * 100;
    const size = (b.pct / total) * fill * 100;
    cum += b.pct;
    bands.push(`<div class="band" style="bottom:${from}%;height:${size}%;background:${TINTS[i % TINTS.length]}59"></div>`);
    keys.push(`<div class="key" style="bottom:${from}%;height:${size}%"><div>
      <b>${esc(b.grape)} · ${esc(b.pct)}%</b>
      <span><em>${esc(b.role)}</em>${b.role_basis === 'guess' ? ' (my read)' : ''}</span>
      <span>${b.similar_to ? 'like ' + esc(b.similar_to) + ' · ' : ''}${esc(b.descriptor || '')}</span>
    </div></div>`);
  });

  const vis = `<div class="vis${blend.length ? '' : ' noblend'}" style="--img:url('${esc(w.image)}')">
    <div class="bottle-box"><img class="base" src="${esc(w.image)}" alt="${esc(wineTitle(w))}">${blend.length ? `<div class="bands">${bands.join('')}</div>` : ''}</div>
    ${blend.length ? `<div class="keys">${keys.join('')}</div>` : ''}
  </div>`;

  const meta = [w.region, w.country].filter(Boolean).join(', ');
  root.innerHTML = `${vis}<div class="info" id="info">
    <p class="meta">${esc(w.producer)} · ${esc(w.cuvee)} ${esc(w.vintage || '')}${meta ? ' · ' + esc(meta) : ''}</p>
    <h1>${esc(wineTitle(w))}</h1>
    ${w.cellar ? '<span class="badge">in my cellar</span>' : ''}
    <div class="post" id="post"></div>
  </div>`;

  const post = document.getElementById('post');
  try {
    const res = await fetch(`posts/${encodeURIComponent(w.slug)}.txt`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('missing');
    const blocks = (await res.text()).replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    if (blocks[0] && blocks[0].startsWith('# ')) {
      document.querySelector('#info h1').textContent = blocks.shift().slice(2);
    }
    post.innerHTML = blocks.map((b) => (b.startsWith('## ')
      ? `<h2>${inline(b.slice(3))}</h2>`
      : `<p>${inline(b).replace(/\n/g, '<br>')}</p>`)).join('');
  } catch (e) {
    post.innerHTML = '<p class="none">nothing written for this one yet.</p>';
  }

  function inline(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>');
  }
})();
