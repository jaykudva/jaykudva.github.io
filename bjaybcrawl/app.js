// ═══════════════════════════════════════════════════════════════════════════
//  BJAY BCRAWL — front-of-house
//  Renders the route from spots.js and polls dispatch for the live position.
// ═══════════════════════════════════════════════════════════════════════════

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = IS_LOCAL ? 'http://localhost:3005' : 'https://bjaybcrawl.vercel.app';

const POLL_MS = 30000;

// phase: 'pre' (not departed) | 'enroute' (heading to stop) | 'at' (at stop) | 'done'
let state = { phase: 'pre', stop: 0, advisory: null, serviceBegins: null, stopsPublic: null };
let fetchedOnce = false;

// departure time: dispatch-set value wins, spots.js is the offline fallback
function serviceBegins() { return state.serviceBegins || CRAWL_CONFIG.serviceBegins; }

function fmtDateDisplay(iso) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
let dispatchOnline = false;
let confettiFired = false;

const $ = (id) => document.getElementById(id);

// ── Render the route ─────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function renderRouteHead() {
  $('routeHead').textContent =
    `${fmtDateDisplay(serviceBegins())} · ${CRAWL_STOPS.length} stops · terminates at ${CRAWL_CONFIG.destination}`;
}

// transfer bullet color by what's served — real MTA line colors
function transferColor(t) {
  if (t.includes('🍷')) return '#EE352E';                    // 1·2·3 red
  if (t.includes('🍺') || t.includes('🍻')) return '#FF6319'; // B·D·F·M orange
  if (t.includes('🌮')) return '#996633';                    // J·Z brown
  return '#0039A6';                                          // A·C·E blue
}

function renderStops() {
  $('stops').innerHTML = CRAWL_STOPS.map((s, i) => {
    const transfers = (s.transfers || [])
      .map(t => `<span class="transfer-inline" style="background:${transferColor(t)}">${esc(t)}</span>`)
      .join('');
    const fare = s.mustOrder
      ? `<div class="station-row"><span class="k">Rec. fare</span><span><span class="fare-tag">${esc(s.mustOrder)}</span></span></div>`
      : '';
    return `
    <div class="stop${s.terminus ? ' terminus' : ''}" id="stop-${i}">
      <span class="stop-dot" aria-hidden="true"></span>
      <div class="station-card" style="animation-delay:${i * 0.12}s">
        <div class="station-badge badge-here">Train at station</div>
        <div class="station-badge badge-next">Train approaching</div>
        <div class="signboard">
          <div class="sign-left${s.neighborhood ? ' has-hood' : ''}">
            ${transfers}
            <div>
              <div class="station-name">${esc(s.name)}</div>
              ${s.neighborhood ? `<div class="station-hood">${esc(s.neighborhood)}</div>` : ''}
            </div>
          </div>
          <span class="station-time">${esc(s.time || '')}</span>
        </div>
        <div class="station-body">
          <div class="station-row"><span class="k">Station</span><span id="addr-${i}"></span></div>
          ${s.note ? `<div class="station-row"><span class="k">Conductor</span><span class="note">“${esc(s.note)}”</span></div>` : ''}
          ${fare}
        </div>
      </div>
    </div>`;
  }).join('');
}

function addressRevealed(i) {
  const s = CRAWL_STOPS[i];
  if (!s.secretAddress) return true;
  if (state.phase === 'done') return true;
  return state.phase !== 'pre' && state.stop >= i;
}

function renderAddresses() {
  CRAWL_STOPS.forEach((s, i) => {
    const el = $(`addr-${i}`);
    if (!el) return;
    if (addressRevealed(i)) {
      el.innerHTML = esc(s.address || 'address TBA') +
        (s.mapsUrl ? ` <a class="directions" href="${esc(s.mapsUrl)}" target="_blank" rel="noopener">Directions ↗</a>` : '');
    } else {
      el.innerHTML = `<span class="locked">🔒 address announced when the train approaches — or ask the conductor</span>`;
    }
  });
}

// ── Live state → page ────────────────────────────────────────────────────────

function visitedBefore() {
  // index below which stops are "departed"
  if (state.phase === 'done') return CRAWL_STOPS.length;
  if (state.phase === 'pre') return 0;
  return state.stop; // at/enroute stop i ⇒ stops 0..i-1 are behind us
}

function applyStateToStops() {
  const v = visitedBefore();
  CRAWL_STOPS.forEach((_, i) => {
    const el = $(`stop-${i}`);
    el.classList.toggle('visited', i < v);
    el.classList.toggle('current', state.phase === 'at' && state.stop === i);
    el.classList.toggle('approaching', state.phase === 'enroute' && state.stop === i);
  });
}

function routeGeometry() {
  const routeTop = $('route').getBoundingClientRect().top;
  const dotCenter = (i) => {
    const r = document.querySelector(`#stop-${i} .stop-dot`).getBoundingClientRect();
    return r.top - routeTop + r.height / 2;
  };
  return { dotCenter, last: CRAWL_STOPS.length - 1 };
}

function layoutLine() {
  const { dotCenter, last } = routeGeometry();
  const line = document.querySelector('.route-line');
  const top = dotCenter(0);
  line.style.top = `${top}px`;
  line.style.bottom = 'auto';
  line.style.height = `${dotCenter(last) - top}px`;
}

function positionMarker() {
  if ($('route').hidden) return; // can't measure a hidden section
  layoutLine();
  const marker = $('trainMarker');
  if (state.phase === 'pre' || (!dispatchOnline && state.phase !== 'done')) {
    marker.classList.add('hidden');
    return;
  }
  marker.classList.remove('hidden');
  marker.classList.toggle('moving', state.phase === 'enroute');

  const { dotCenter, last } = routeGeometry();
  let y;
  if (state.phase === 'done') {
    y = dotCenter(last);
  } else if (state.phase === 'at') {
    y = dotCenter(Math.min(state.stop, last));
  } else { // enroute to state.stop
    const to = Math.min(state.stop, last);
    y = to === 0 ? dotCenter(0) - 60 : (dotCenter(to - 1) + dotCenter(to)) / 2;
  }
  marker.style.top = `${Math.max(0, y - 18)}px`;
}

function renderAdvisory() {
  const box = $('advisory');
  if (state.advisory) {
    $('advisoryText').textContent = state.advisory;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

// ── Countdown clock board ────────────────────────────────────────────────────

function fmtCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return d > 0 ? `${d}D ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

let flip = false; // alternator for two-message boards

function renderClock() {
  const l1 = $('clockLine1');
  const l2 = $('clockLine2');
  const line1 = (txt) => `<span class="bullet">J</span><span class="t">${txt}</span>`;
  l2.classList.remove('blink');

  if (state.phase === 'done') {
    l1.innerHTML = line1('SERVICE COMPLETE');
    l2.textContent = flip ? 'THANK YOU FOR RIDING' : '🎉 HAPPY BIRTHDAY JAY 🎉';
    return;
  }
  if (state.phase === 'at') {
    const s = CRAWL_STOPS[state.stop];
    if (s?.terminus) {
      l1.innerHTML = line1(`NOW AT ${esc(s.name).toUpperCase()}`);
      l2.textContent = flip ? 'THIS IS THE LAST STOP' : '🎉 HAPPY BIRTHDAY JAY 🎉';
    } else {
      l1.innerHTML = line1('NOW STOPPED AT');
      l2.textContent = (s?.name || '—').toUpperCase();
    }
    return;
  }
  if (state.phase === 'enroute') {
    const s = CRAWL_STOPS[state.stop];
    l1.innerHTML = line1('NEXT STOP');
    l2.textContent = (s?.name || '—').toUpperCase();
    l2.classList.add('blink');
    return;
  }
  // pre-departure
  const diff = new Date(serviceBegins()) - Date.now();
  l1.innerHTML = line1(`TO ${esc(CRAWL_CONFIG.destination).toUpperCase()}`);
  if (diff > 0) {
    l2.textContent = `SERVICE IN ${fmtCountdown(diff)}`;
  } else if (dispatchOnline) {
    l2.textContent = 'TRAIN BEING PREPARED IN YARD';
    l2.classList.add('blink');
  } else {
    l2.textContent = `SERVICE BEGINS ${fmtDateDisplay(serviceBegins()).toUpperCase()}`;
  }
}

function renderClockFoot() {
  const foot = $('clockFoot');
  foot.classList.toggle('offline', !dispatchOnline);
  $('clockFootText').textContent = dispatchOnline
    ? 'live from dispatch'
    : 'dispatch offline — schedule shown';
}

// ── Birthday confetti (fires once when the train reaches the terminus) ──────

function fireConfetti() {
  if (confettiFired || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  confettiFired = true;
  const colors = ['#FF6319', '#FCCC0A', '#00933C', '#0039A6', '#EE352E', '#B933AD'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = `${2.4 + Math.random() * 2.6}s`;
    c.style.animationDelay = `${Math.random() * 1.4}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 7000);
  }
}

// ── Dispatch polling ─────────────────────────────────────────────────────────

async function fetchStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state = {
      phase: data.phase || 'pre',
      stop: Number.isInteger(data.stop) ? data.stop : 0,
      advisory: data.advisory || null,
      serviceBegins: data.service_begins || null,
      stopsPublic: data.stops_public === true,
    };
    dispatchOnline = true;
  } catch {
    dispatchOnline = false;
  }
  fetchedOnce = true;
  render();
}

// Teaser mode: until dispatch says stops_public, only the board + teaser show.
// Before the first fetch resolves, show neither (no flash of the wrong one).
// If dispatch is unreachable, fail open — better to show the schedule than
// hide it from someone standing outside a bar.
function applyReveal() {
  let showStops = null;
  if (fetchedOnce) showStops = dispatchOnline ? state.stopsPublic : true;
  $('route').hidden = showStops !== true;
  $('teaser').hidden = showStops !== false;
}

function render() {
  applyReveal();
  renderRouteHead();
  applyStateToStops();
  renderAddresses();
  renderAdvisory();
  renderClock();
  renderClockFoot();
  positionMarker();
  const atTerminus = state.phase === 'done' ||
    (state.phase === 'at' && CRAWL_STOPS[state.stop]?.terminus);
  if (atTerminus && dispatchOnline) fireConfetti();
}

// ── Boot ─────────────────────────────────────────────────────────────────────

renderStops();
render();
fetchStatus();
setInterval(fetchStatus, POLL_MS);
setInterval(() => { flip = !flip; renderClock(); }, 4000);
setInterval(() => { if (state.phase === 'pre') renderClock(); }, 1000);
window.addEventListener('resize', positionMarker);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fetchStatus();
});
// marker position depends on final layout (fonts, images)
window.addEventListener('load', positionMarker);
