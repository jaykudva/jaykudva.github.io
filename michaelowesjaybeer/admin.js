// ── Config ────────────────────────────────────────────────────────────────────
// Keep in sync with app.js (see SETUP.md).
const API =
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3004'
    : 'https://michaelowesjaybeer.vercel.app';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'beer_clerk_pass';

let pass = localStorage.getItem(STORAGE_KEY) || null;

const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
};

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(pass ? { 'Authorization': `Bearer ${pass}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Gate ──────────────────────────────────────────────────────────────────────

async function presentCredentials() {
  const errEl = $('gate-error');
  errEl.classList.add('hidden');
  const candidate = $('gate-password').value;
  if (!candidate) return;

  $('gate-btn').disabled = true;
  try {
    await api('POST', '/api/login', { password: candidate });
    pass = candidate;
    localStorage.setItem(STORAGE_KEY, pass);
    enterDesk();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    $('gate-btn').disabled = false;
  }
}

function surrenderCredentials() {
  pass = null;
  localStorage.removeItem(STORAGE_KEY);
  $('desk').classList.add('hidden');
  $('gate').classList.remove('hidden');
}

function enterDesk() {
  $('gate').classList.add('hidden');
  $('desk').classList.remove('hidden');
  $('f-date').value = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local tz
  loadEntries();
}

// ── The record ────────────────────────────────────────────────────────────────

async function loadEntries() {
  const box = $('clerk-entries');
  try {
    const { outstanding, entries } = await api('GET', '/api/ledger');
    $('record-count').textContent = `· ${outstanding} outstanding`;

    if (!entries.length) {
      box.innerHTML = '<p class="ledger-empty">The record is empty. Michael is, for now, a man of honor.</p>';
      return;
    }
    box.innerHTML = entries.map(e => {
      const credit = e.kind === 'credit';
      return `
      <div class="clerk-entry" data-id="${e.id}">
        <div class="ce-main">
          <span class="ce-qty ${credit ? 'is-credit' : ''}">${credit ? `−${e.quantity}` : `+${e.quantity}`}</span>
          <span class="ce-date">${fmtDate(e.occurred_on)}</span>
          <span class="ce-location">${e.location ? esc(e.location) : (credit ? 'Settlement' : '—')}</span>
          ${e.memorandum ? `<div class="ce-memo">${esc(e.memorandum)}</div>` : ''}
        </div>
        <div class="ce-actions">
          <button class="btn btn-ghost btn-small btn-danger" data-action="strike">Strike</button>
        </div>
      </div>
    `;
    }).join('');
  } catch (err) {
    box.innerHTML = `<p class="ledger-empty">${esc(err.message)}</p>`;
  }
}

async function handleEntryAction(ev) {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.clerk-entry').dataset.id;

  try {
    if (btn.dataset.action === 'strike') {
      if (!confirm('Strike this entry from the record forever?')) return;
      await api('DELETE', `/api/entries/${id}`);
    }
    loadEntries();
  } catch (err) {
    alert(err.message);
  }
}

async function submitEntry(ev) {
  ev.preventDefault();
  const errEl = $('form-error');
  const okEl  = $('form-ok');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');
  $('f-submit').disabled = true;

  try {
    await api('POST', '/api/entries', {
      occurred_on: $('f-date').value,
      kind:        $('f-kind').value,
      quantity:    $('f-qty').value,
      location:    $('f-location').value,
      memorandum:  $('f-memo').value,
    });
    $('f-location').value = '';
    $('f-memo').value = '';
    $('f-qty').value = '1';
    okEl.classList.remove('hidden');
    setTimeout(() => okEl.classList.add('hidden'), 2500);
    loadEntries();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    $('f-submit').disabled = false;
  }
}

// ── Wire up ───────────────────────────────────────────────────────────────────

$('gate-btn').addEventListener('click', presentCredentials);
$('gate-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') presentCredentials(); });
$('entry-form').addEventListener('submit', submitEntry);
$('clerk-entries').addEventListener('click', handleEntryAction);
$('logout-btn').addEventListener('click', surrenderCredentials);

if (pass) enterDesk();
