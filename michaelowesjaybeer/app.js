// ── Config ────────────────────────────────────────────────────────────────────
// PROD url is the Vercel deployment of ./server (see SETUP.md).
const API =
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3004'
    : 'https://michaelowesjaybeer.vercel.app';

const $ = (id) => document.getElementById(id);

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

// ── The figure ────────────────────────────────────────────────────────────────

function countUp(el, target, done) {
  if (target === 0) {
    el.textContent = 'NIL';
    el.classList.add('is-nil');
    done();
    return;
  }
  const duration = Math.min(1600, 400 + target * 260);
  const start = performance.now();
  (function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(eased * target);
    if (t < 1) requestAnimationFrame(tick);
    else done();
  })(performance.now());
}

function slamStamp(outstanding) {
  const stamp = $('stamp');
  if (outstanding === 0) {
    stamp.textContent = 'Settled in Full';
    stamp.classList.add('settled');
  } else if (outstanding < 0) {
    stamp.textContent = 'Overpaid';
    stamp.classList.add('settled');
  }
  stamp.classList.add('slam');
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderFigure(outstanding) {
  const label = $('beer-label');
  if (outstanding < 0) {
    // Michael has somehow overshot. An administrative embarrassment.
    label.textContent = `…wait. Jay owes Michael ${Math.abs(outstanding)} — audit pending`;
  } else {
    label.textContent = outstanding === 1 ? 'standard-issue beer' : 'standard-issue beers';
  }

  setTimeout(() => {
    countUp($('beer-count'), Math.max(0, outstanding), () =>
      setTimeout(() => slamStamp(outstanding), 250));
  }, 650);
}

function renderInterest(interest, accrual) {
  if (!accrual.active) return;

  $('vital-rate').innerHTML = '1 beer&nbsp;/&nbsp;wk&nbsp;<sup>†</sup>';

  const sub = $('fig-sub');
  sub.textContent = `incl. ${interest} punitive-interest beer${interest === 1 ? '' : 's'} — see clause †`;
  sub.classList.remove('hidden');
}

function interestRow(interest, accrual) {
  const next = new Date(accrual.next_accrual).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `
    <tr class="is-interest">
      <td>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
      <td>The Bureau itself</td>
      <td class="memo">Punitive accrual per clause † — ${accrual.aged} obligations aged beyond 21 days. Next beer accrues ${next}.</td>
      <td class="col-status"><span class="status-owed">+${interest} accrued</span></td>
    </tr>
  `;
}

function renderVitals(entries, outstanding, settled) {
  const debits = entries.filter(e => e.kind === 'debit');
  const oldest = debits.length ? debits[debits.length - 1].occurred_on : null;

  $('vital-first').textContent = oldest ? fmtDate(oldest) : '—';
  $('vital-settled').textContent = String(settled);

  if (oldest && outstanding > 0) {
    const [y, m, d] = oldest.split('-').map(Number);
    const days = Math.max(0, Math.floor((Date.now() - new Date(y, m - 1, d)) / 86400000));
    $('vital-days').textContent = String(days);
  } else {
    $('vital-days').textContent = '0';
  }
}

function renderLedger(entries, interest, accrual) {
  const body = $('ledger-body');
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="4" class="ledger-empty">The record is empty. A rare moment of solvency.</td></tr>';
    return;
  }
  body.innerHTML = (accrual.active ? interestRow(interest, accrual) : '') + entries.map(e => {
    const credit = e.kind === 'credit';
    return `
      <tr class="${credit ? 'is-credit' : ''}">
        <td>${fmtDate(e.occurred_on)}</td>
        <td>${e.location ? esc(e.location) : '<span class="memo">—</span>'}</td>
        <td class="memo">${e.memorandum ? esc(e.memorandum) : (credit ? 'Settlement rendered.' : '—')}</td>
        <td class="col-status">
          <span class="${credit ? 'status-settled' : 'status-owed'}">${credit ? `−${e.quantity} settled` : `+${e.quantity} owed`}</span>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  $('issued-date').textContent = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  try {
    const res = await fetch(`${API}/api/ledger`);
    if (!res.ok) throw new Error('ledger unavailable');
    const { outstanding, settled, interest, accrual, entries } = await res.json();

    $('serial').textContent = String(entries.length + 1).padStart(4, '0');
    renderVitals(entries, outstanding, settled);
    renderLedger(entries, interest, accrual);
    renderInterest(interest, accrual);
    renderFigure(outstanding);
  } catch (err) {
    $('beer-count').textContent = '?';
    $('beer-label').textContent = 'beers — the record keeper is unreachable';
    $('ledger-body').innerHTML =
      '<tr><td colspan="4" class="ledger-empty">The Bureau’s records are temporarily unavailable. The debt, however, persists.</td></tr>';
  }
}

init();
