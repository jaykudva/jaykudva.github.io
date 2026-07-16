// ═══════════════════════════════════════════════════════════════════════════
//  BJAY BCRAWL DISPATCH — rail control
// ═══════════════════════════════════════════════════════════════════════════

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = IS_LOCAL ? 'http://localhost:3005' : 'https://bjaybcrawl.vercel.app';

const $ = (id) => document.getElementById(id);

let state = { phase: 'pre', stop: 0, advisory: null, updated_at: null };

const ADVISORY_PRESETS = [
  'BJAY BCRAWL trains are running 20 min behind schedule due to an unplanned second round.',
  'Expect crowding at the front of the train. The birthday boy is buying.',
  'Delays due to cake on the tracks.',
  'Good service on the BJAY BCRAWL. Suspiciously good.',
];

function token() { return sessionStorage.getItem('bjayb_dispatch') || ''; }

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` };
}

// ── Status board ─────────────────────────────────────────────────────────────

function stopName(i) { return CRAWL_STOPS[i]?.name || `stop ${i + 1}`; }

// ISO → value for <input type="datetime-local"> in the device's timezone
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderBoard() {
  const phaseLabel = {
    pre: 'IN YARD — NOT DEPARTED',
    enroute: 'EN ROUTE TO',
    at: 'STOPPED AT',
    done: 'SERVICE COMPLETE',
  }[state.phase] || '—';
  $('boardPhase').textContent = phaseLabel;
  $('boardStop').textContent =
    state.phase === 'pre' ? 'BJAY BCRAWL' :
    state.phase === 'done' ? 'THANK YOU FOR RIDING' :
    stopName(state.stop).toUpperCase();
  $('boardMeta').textContent = [
    state.advisory ? `ADVISORY: ${state.advisory}` : 'NO ADVISORIES',
    state.updated_at ? `UPDATED ${new Date(state.updated_at).toLocaleTimeString()}` : '',
  ].filter(Boolean).join(' · ');
}

function renderTimeline() {
  $('timeline').innerHTML = CRAWL_STOPS.map((s, i) => {
    const cls = state.stop === i && state.phase === 'at' ? 'active-at'
      : state.stop === i && state.phase === 'enroute' ? 'active-enroute' : '';
    return `
    <li class="${cls}">
      <span class="name">${i + 1}. ${s.name}<small>${s.time || ''} · ${s.neighborhood || ''}</small></span>
      <button class="btn-caution" data-phase="enroute" data-stop="${i}">→ en route</button>
      <button class="btn-green" data-phase="at" data-stop="${i}">● arrived</button>
    </li>`;
  }).join('');
  $('timeline').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () =>
      setPosition(b.dataset.phase, parseInt(b.dataset.stop, 10)));
  });
}

// ── API ──────────────────────────────────────────────────────────────────────

async function fetchStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error(res.status);
    state = await res.json();
    $('advisoryInput').value = state.advisory || '';
    const dep = $('departureInput');
    if (state.service_begins && document.activeElement !== dep) {
      dep.value = toLocalInput(state.service_begins);
    }
  } catch {
    $('boardStop').textContent = 'DISPATCH UNREACHABLE';
    $('boardMeta').textContent = 'is the server deployed / running?';
  }
  renderBoard();
  renderTimeline();
  renderRevealButton();
}

async function login() {
  const password = $('password').value;
  const msg = $('loginMsg');
  msg.className = 'msg';
  msg.textContent = 'checking…';
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'sign-in failed');
    sessionStorage.setItem('bjayb_dispatch', password);
    showControls();
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = e.message;
  }
}

async function updateState(patch, msgEl) {
  msgEl.className = 'msg';
  msgEl.textContent = 'transmitting…';
  try {
    const res = await fetch(`${API_BASE}/api/status`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'update failed');
    state = data;
    renderBoard();
    renderTimeline();
    renderRevealButton();
    msgEl.className = 'msg ok';
    msgEl.textContent = '✓ posted to the line';
  } catch (e) {
    msgEl.className = 'msg err';
    msgEl.textContent = e.message;
  }
}

function setPosition(phase, stop) {
  updateState({ phase, stop }, $('posMsg'));
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function renderRevealButton() {
  $('btnReveal').textContent = state.stops_public
    ? '🔒 Hide the stops (back to teaser)'
    : '📢 Announce the stops (release the site)';
}

function showControls() {
  $('loginPanel').classList.add('hidden');
  $('controlPanel').classList.remove('hidden');
  $('revealPanel').classList.remove('hidden');
  $('departurePanel').classList.remove('hidden');
  $('advisoryPanel').classList.remove('hidden');
}

$('loginBtn').addEventListener('click', login);
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

$('btnYard').addEventListener('click', () => setPosition('pre', 0));
$('btnDone').addEventListener('click', () => setPosition('done', CRAWL_STOPS.length - 1));

$('btnReveal').addEventListener('click', () =>
  updateState({ stops_public: !state.stops_public }, $('revealMsg')));

$('btnSetDeparture').addEventListener('click', () => {
  const val = $('departureInput').value;
  if (!val) {
    $('depMsg').className = 'msg err';
    $('depMsg').textContent = 'pick a date and time first';
    return;
  }
  updateState({ service_begins: new Date(val).toISOString() }, $('depMsg'));
});

$('btnPostAdvisory').addEventListener('click', () =>
  updateState({ advisory: $('advisoryInput').value.trim() || null }, $('advMsg')));
$('btnClearAdvisory').addEventListener('click', () => {
  $('advisoryInput').value = '';
  updateState({ advisory: null }, $('advMsg'));
});

$('advisoryChips').innerHTML = ADVISORY_PRESETS
  .map((p, i) => `<button data-i="${i}">${p}</button>`).join('');
$('advisoryChips').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => { $('advisoryInput').value = ADVISORY_PRESETS[b.dataset.i]; });
});

if (token()) showControls();
fetchStatus();
setInterval(fetchStatus, 45000);
