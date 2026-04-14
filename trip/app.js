// ── Constants ─────────────────────────────────────────────────────────────────

// Backend API — local dev vs deployed. Update PROD_API_BASE when you deploy the server.
const IS_LOCAL    = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE    = IS_LOCAL ? 'http://localhost:3001' : 'https://grouptrip-phi.vercel.app';

const STORAGE_KEY = 'trip-planner-v2';
const START_HOUR  = 0;
const END_HOUR    = 23;
const N_HOURS     = END_HOUR - START_HOUR + 1; // 24
const HOURS       = Array.from({ length: N_HOURS }, (_, i) => i + START_HOUR);
const FIXED_COL_W = 180; // px for >7 days

const PEOPLE_LABEL = { jay: 'Jay', abi: 'Abi', austin: 'Austin', johanna: 'Johanna' };
const COUPLE_MAP   = { jay: 'jay-abi', abi: 'jay-abi', austin: 'austin-johanna', johanna: 'austin-johanna' };
const CAT_COLOR    = { food: '#f97316', activity: '#22c55e', accommodation: '#3b82f6', transport: '#a855f7', other: '#64748b' };
const CAT_LABEL    = { food: 'Food & Drink', activity: 'Activity', accommodation: 'Stay', transport: 'Transport', other: 'Other' };

// ── State ─────────────────────────────────────────────────────────────────────

function defaultState() {
  return { tripName: 'My Trip', startDate: '', endDate: '', events: [], home: null, flights: [] };
}

let state = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState();
    if (!s.flights) s.flights = []; // migrate old saves
    return s;
  } catch { return defaultState(); }
})();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleSyncSave();
}
function uid()  { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

// ── API sync & auth ──────────────────────────────────────────────────────────

const SYNC_INTERVAL_MS = 15_000;
const PASSWORD_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
function loadStoredPassword() {
  const pw  = localStorage.getItem('trip-password') || '';
  const ts  = parseInt(localStorage.getItem('trip-password-ts') || '0', 10);
  if (pw && Date.now() - ts < PASSWORD_TTL_MS) return pw;
  if (pw) { localStorage.removeItem('trip-password'); localStorage.removeItem('trip-password-ts'); }
  return '';
}
let syncPassword   = loadStoredPassword();
let lastSyncedAt   = null;   // ISO string of the server's last updated_at we've applied
let syncSaveTimer  = null;
let syncPollTimer  = null;
let syncStatusEl   = null;   // set after DOM ready

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'X-Trip-Password': syncPassword };
}

function setSyncStatus(msg, cls = '') {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = msg;
  syncStatusEl.className   = 'sync-status' + (cls ? ' ' + cls : '');
  if (cls === 'saved') setTimeout(() => { if (syncStatusEl.textContent === msg) syncStatusEl.textContent = ''; }, 2500);
}

async function syncLoad() {
  try {
    const res = await fetch(`${API_BASE}/api/state`, { headers: apiHeaders() });
    if (res.status === 401) { showPasswordGate(); return false; }
    if (!res.ok) return false;
    const { state: remote, updatedAt } = await res.json();
    if (remote) {
      state = remote;
      if (!state.flights) state.flights = [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    lastSyncedAt = updatedAt;
    return true;
  } catch { return false; }
}

async function syncSave() {
  clearTimeout(syncSaveTimer);
  syncSaveTimer = null;
  if (!syncPassword) return;
  setSyncStatus('Saving…');
  try {
    const res = await fetch(`${API_BASE}/api/state`, {
      method: 'PUT',
      headers: apiHeaders(),
      body: JSON.stringify({ state }),
    });
    if (res.status === 401) { showPasswordGate(); return; }
    if (!res.ok) { setSyncStatus('Save failed', 'error'); return; }
    const { updatedAt } = await res.json();
    lastSyncedAt = updatedAt;
    setSyncStatus('Saved', 'saved');
  } catch { setSyncStatus('Save failed', 'error'); }
}

function scheduleSyncSave() {
  clearTimeout(syncSaveTimer);
  syncSaveTimer = setTimeout(syncSave, 1500);
}

async function syncPoll() {
  if (!syncPassword) return;
  try {
    const res = await fetch(`${API_BASE}/api/state`, { headers: apiHeaders() });
    if (!res.ok) return;
    const { state: remote, updatedAt } = await res.json();
    if (remote && updatedAt && updatedAt !== lastSyncedAt) {
      // Someone else saved — only accept if we're not mid-edit
      if (!syncSaveTimer) {
        state = remote;
        if (!state.flights) state.flights = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        lastSyncedAt = updatedAt;
        render();
        setSyncStatus('Updated', 'saved');
      }
    }
  } catch { /* ignore poll errors */ }
}

function startSyncPoll() {
  clearInterval(syncPollTimer);
  syncPollTimer = setInterval(syncPoll, SYNC_INTERVAL_MS);
}

// ── Password gate ─────────────────────────────────────────────────────────────

function showPasswordGate() {
  syncPassword = '';
  localStorage.removeItem('trip-password');
  localStorage.removeItem('trip-password-ts');
  document.getElementById('password-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('password-input').focus(), 50);
}

function hidePasswordGate() {
  document.getElementById('password-overlay').classList.add('hidden');
}

async function submitPassword() {
  const input = document.getElementById('password-input');
  const errEl = document.getElementById('password-error');
  const pw    = input.value.trim();
  if (!pw) return;
  const btn = document.getElementById('password-submit');
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/state`, {
      headers: { 'X-Trip-Password': pw },
    });
    if (res.status === 401) {
      errEl.textContent = 'Wrong password. Try again.';
      errEl.classList.remove('hidden');
      input.value = '';
      input.focus();
      return;
    }
    syncPassword = pw;
    localStorage.setItem('trip-password', pw);
    localStorage.setItem('trip-password-ts', Date.now().toString());
    const { state: remote, updatedAt } = await res.json();
    if (remote) {
      state = remote;
      if (!state.flights) state.flights = [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    lastSyncedAt = updatedAt;
    hidePasswordGate();
    updateHomeButton();
    render();
    scrollToHour(17);
    startSyncPoll();
  } catch {
    errEl.textContent = 'Could not reach the server. Try again.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

// ── UI state (not persisted) ──────────────────────────────────────────────────

let viewFilter = 'all';          // 'all' | 'jay-abi' | 'austin-johanna'
let activeTab  = 'calendar';     // 'calendar' | 'map'
let leafletMap   = null;
let mapTileLayer = null;
let mapMarkers   = [];
let mapDayFilter = null;   // null = all, integer = specific day
let isDark       = localStorage.getItem('trip-theme') !== 'light';

// ── Derived helpers ───────────────────────────────────────────────────────────

// Parse a YYYY-MM-DD string in LOCAL time (avoids UTC-rollback bug).
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getDayCount() {
  if (!state.startDate || !state.endDate) return 0;
  const diff = Math.round((parseLocalDate(state.endDate) - parseLocalDate(state.startDate)) / 86400000) + 1;
  return Math.max(1, diff);
}

function getDayDate(day) {
  if (!state.startDate) return null;
  const d = parseLocalDate(state.startDate);
  d.setDate(d.getDate() + day - 1);
  return d;
}

function getDayLabel(day) {
  const d = getDayDate(day);
  if (!d) return { num: day, dow: '', date: `Day ${day}` };
  return {
    num:  day,
    dow:  d.toLocaleDateString('en-US', { weekday: 'short' }),
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

function formatHour(h) {
  if (h > 24) return formatHour(h - 24);
  const whole = Math.floor(h);
  const mins  = (h % 1 >= 0.5) ? ':30' : '';
  if (whole === 0)  return `12${mins} AM`;
  if (whole === 12) return `12${mins} PM`;
  return whole < 12 ? `${whole}${mins} AM` : `${whole - 12}${mins} PM`;
}

function getHourHeight() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-height')) || 64;
}

function getDayHeaderH() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--day-header-h')) || 52;
}

// ── Flight / timezone helpers ─────────────────────────────────────────────────

const TRIP_TZ = 'America/Mexico_City';

// Convert an ISO datetime string to a fractional hour in CDMX time (e.g. 14.5 = 2:30 PM)
function toTripHour(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TRIP_TZ, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d);
  let h = parseInt(parts.find(p => p.type === 'hour')?.value  ?? '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  if (h === 24) h = 0;
  return h + m / 60;
}

// Return "YYYY-MM-DD" for an ISO datetime in CDMX time
function toTripDateStr(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleDateString('en-CA', { timeZone: TRIP_TZ });
}

// Return trip day number (1-based) for an ISO datetime interpreted in CDMX time, or null
function isoToTripDay(isoStr) {
  const dateStr = toTripDateStr(isoStr);
  if (!dateStr || !state.startDate) return null;
  const start = parseLocalDate(state.startDate);
  const target = parseLocalDate(dateStr);
  const diff = Math.round((target - start) / 86400000) + 1;
  return diff >= 1 && diff <= getDayCount() ? diff : null;
}

// Return trip day number for a flight object using its stored date string
function flightDay(f) {
  if (!f.date || !state.startDate) return null;
  const start = parseLocalDate(state.startDate);
  const target = parseLocalDate(f.date);
  const diff = Math.round((target - start) / 86400000) + 1;
  return diff >= 1 && diff <= getDayCount() ? diff : null;
}

// Does this flight match the current view filter?
function flightMatchesView(flight) {
  if (viewFilter === 'all') return true;
  return (flight.people || []).some(p => COUPLE_MAP[p] === viewFilter);
}

// ── View filter helpers ───────────────────────────────────────────────────────

// Returns 'group' | 'jay-abi' | 'austin-johanna'
function eventScope(evt) {
  const people = evt.people || [];
  if (people.length === 0) return 'group';
  const couples = new Set(people.map(p => COUPLE_MAP[p]).filter(Boolean));
  return couples.size > 1 ? 'group' : ([...couples][0] || 'group');
}

// Should this event show in the current viewFilter?
function eventMatchesView(evt) {
  if (viewFilter === 'all') return true;
  const scope = eventScope(evt);
  return scope === 'group' || scope === viewFilter;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const tripNameEl   = document.getElementById('trip-name');
const startDateEl  = document.getElementById('start-date');
const endDateEl    = document.getElementById('end-date');
const btnAddEvent      = document.getElementById('btn-add-event');
const btnAddFlight     = document.getElementById('btn-add-flight');
const btnTheme         = document.getElementById('btn-theme');
const btnHome          = document.getElementById('btn-home');
const homeLabel        = document.getElementById('home-label');
const homeModalOverlay = document.getElementById('home-modal-overlay');
const homeAddressEl    = document.getElementById('home-address');
const btnHomeLocate    = document.getElementById('btn-home-locate');
const homeLocStatus    = document.getElementById('home-location-status');
const homeModalClear   = document.getElementById('home-modal-clear');
const homeModalCancel  = document.getElementById('home-modal-cancel');
const homeModalSave    = document.getElementById('home-modal-save');
const filterBtns   = document.querySelectorAll('.filter-btn');
const tabBtns      = document.querySelectorAll('.tab-btn');
const calendarView = document.getElementById('calendar-view');
const mapView      = document.getElementById('map-view');
const mapLegend         = document.getElementById('map-legend');
const calZoomControl    = document.getElementById('cal-zoom-control');
const btnHomeTravelCtrl = document.getElementById('btn-home-travel');
const mapNoCoordsEl  = document.getElementById('map-no-coords');
const mapDayStrip    = document.getElementById('map-day-strip');
const usBar        = document.getElementById('unscheduled-bar');
const toggleUs     = document.getElementById('toggle-unscheduled');
const usCount      = document.getElementById('us-count');
const pool         = document.getElementById('pool');
const calContainer = document.getElementById('calendar-container');
const calScroll    = document.getElementById('calendar-scroll');
const daysArea     = document.getElementById('days-area');
const timeGutter   = document.getElementById('time-gutter');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle   = document.getElementById('modal-title');
const evtTitle     = document.getElementById('evt-title');
const evtCategory  = document.getElementById('evt-category');
const evtDay       = document.getElementById('evt-day');
const evtTime      = document.getElementById('evt-time');
const evtDuration  = document.getElementById('evt-duration');
const evtPlace     = document.getElementById('evt-place');
const placeInfoEl  = document.getElementById('place-info');
const evtNotes     = document.getElementById('evt-notes');
const resNo        = document.getElementById('res-no');
const resYes       = document.getElementById('res-yes');
const resGroup     = document.getElementById('reservation-details-group');
const evtRes       = document.getElementById('evt-reservation');
const modalDelete  = document.getElementById('modal-delete');
const modalCancel  = document.getElementById('modal-cancel');
const modalSave    = document.getElementById('modal-save');
const btnLocate    = document.getElementById('btn-locate');
const locStatus    = document.getElementById('location-status');
const peopleChips  = document.querySelectorAll('#people-chips .person-chip');

// ── Layout / sizing ───────────────────────────────────────────────────────────

const calZoomEl = document.getElementById('cal-zoom');

function updateHourHeight() {
  const usable = calContainer.clientHeight - getDayHeaderH();
  // min: fit all 24 hours without scrolling (at least 20px per hour)
  const minHH  = Math.max(20, usable / N_HOURS);
  // max: show ~10 hours (anything smaller scrolls)
  const maxHH  = Math.max(minHH, usable / 10);

  const pct = parseInt(calZoomEl.value, 10) / 100;
  const hh  = minHH + pct * (maxHH - minHH);

  // Scroll only when zoomed in beyond the point of fitting everything
  calScroll.style.overflowY = hh > usable / N_HOURS + 0.5 ? 'auto' : 'hidden';

  document.documentElement.style.setProperty('--hour-height', hh + 'px');
}

// Restore saved zoom before first render (default 50 = halfway)
calZoomEl.value = localStorage.getItem('trip-cal-zoom') ?? '50';

calZoomEl.addEventListener('input', () => {
  localStorage.setItem('trip-cal-zoom', calZoomEl.value);
  updateHourHeight();
  repositionAllCards();
  // Travel indicators use CSS calc — they reposition automatically
});

function updateColumnWidths() {
  const n = getDayCount();
  document.querySelectorAll('.day-col').forEach(col => {
    if (n > 7) { col.style.minWidth = FIXED_COL_W + 'px'; col.style.flex = 'none'; }
    else        { col.style.minWidth = ''; col.style.flex = '1'; }
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  document.title    = (state.tripName || 'My Trip') + ' — Trip Planner';
  tripNameEl.value  = state.tripName || '';
  startDateEl.value = state.startDate || '';
  endDateEl.value   = state.endDate || '';

  renderTimeGutter();
  renderDays();
  renderUnscheduled();
  updateHourHeight();
  updateColumnWidths();

  if (activeTab === 'map') { renderMapDayStrip(); renderMap(); }

  // Async: fetch travel times and inject indicators after render settles
  if (activeTab === 'calendar') renderTravelTimes();
}

function renderTimeGutter() {
  timeGutter.querySelectorAll('.hour-label').forEach(el => el.remove());
  HOURS.forEach(h => {
    const el = document.createElement('div');
    el.className   = 'hour-label';
    el.textContent = formatHour(h);
    timeGutter.appendChild(el);
  });
}

function renderDays() {
  daysArea.innerHTML = '';
  const n = getDayCount();
  if (n === 0) {
    daysArea.innerHTML = `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:14px;padding:40px;">Set a date range above to get started.</div>`;
    return;
  }
  for (let d = 1; d <= n; d++) daysArea.appendChild(makeDayCol(d));
}

function makeDayCol(day) {
  const col = document.createElement('div');
  col.className  = 'day-col';
  col.dataset.day = day;

  // Header
  const head = document.createElement('div');
  head.className = 'day-head';
  const lbl = getDayLabel(day);
  head.innerHTML = `
    <div class="day-head-num">Day ${lbl.num}</div>
    <div class="day-head-date">${lbl.date}</div>
    <div class="day-head-dow">${lbl.dow}</div>
  `;
  col.appendChild(head);

  // Hour cells
  HOURS.forEach(h => {
    const cell = document.createElement('div');
    cell.className    = 'hour-cell';
    cell.dataset.day  = day;
    cell.dataset.hour = h;
    cell.addEventListener('click', onCellClick);
    col.appendChild(cell);
  });

  col.addEventListener('dragover',  onDragOver);
  col.addEventListener('dragleave', onDragLeave);
  col.addEventListener('drop',      onDrop);

  // Place events — only those with a time; day+no-time appear in the unscheduled bar
  const timedEvents = state.events.filter(e => e.day === day && e.hour != null);
  const layout      = computeDayLayout(timedEvents);
  timedEvents.forEach(evt => {
    const card              = makeEventCard(evt);
    const { col: c, cols }  = layout.get(evt.id) || { col: 0, cols: 1 };
    positionCard(card, evt, c, cols);
    col.appendChild(card);
  });

  // Place flight blocks for this day
  (state.flights || []).forEach(f => {
    if (!flightMatchesView(f)) return;
    const arrDay = flightDay(f);
    if (arrDay !== day) return;

    const depHour       = f.depHourCDMX;
    const arrHour       = f.arrHourCDMX;
    if (depHour == null || arrHour == null) return;

    // A departure flight leaves FROM the trip city; an arrival flight lands there.
    const isTripDeparture = f.departure?.tz === TRIP_TZ;

    if (isTripDeparture) {
      // Block out everything AFTER departure — they've left
      const greyStart = depHour - START_HOUR;
      const greyHours = N_HOURS - greyStart;
      if (greyHours > 0) {
        const grayout = document.createElement('div');
        grayout.className = 'flight-grayout';
        grayout.style.top    = `calc(var(--day-header-h) + ${greyStart} * var(--hour-height))`;
        grayout.style.height = `calc(${greyHours} * var(--hour-height))`;
        const lbl = document.createElement('div');
        lbl.className = 'flight-grayout-label';
        lbl.textContent = 'Left CDMX';
        grayout.appendChild(lbl);
        col.appendChild(grayout);
      }
    } else {
      // Block out everything BEFORE arrival — not in CDMX yet
      const greyHours = depHour - START_HOUR;
      if (greyHours > 0) {
        const grayout = document.createElement('div');
        grayout.className = 'flight-grayout';
        grayout.style.height = `calc(${greyHours} * var(--hour-height))`;
        const lbl = document.createElement('div');
        lbl.className = 'flight-grayout-label';
        lbl.textContent = 'Not in CDMX';
        grayout.appendChild(lbl);
        col.appendChild(grayout);
      }
    }

    // Flight card — spans dep→arr regardless of direction
    const dur = Math.max(0.5, arrHour - depHour);
    const fcard = document.createElement('div');
    fcard.className = 'event-card flight-card';
    fcard.dataset.flightId = f.id;
    fcard.style.top    = `calc(var(--day-header-h) + ${depHour - START_HOUR} * var(--hour-height))`;
    fcard.style.height = `calc(${dur} * var(--hour-height) - 4px)`;
    fcard.innerHTML = `
      <div class="event-card-title">✈ ${f.number}</div>
      <div class="event-card-meta">
        <span class="event-time-label">${f.departure.iata} → ${f.arrival.iata}</span>
      </div>
    `;
    fcard.addEventListener('click', () => openFlightModal(f.id));
    col.appendChild(fcard);
  });

  return col;
}

// Compute side-by-side column layout for overlapping events in a day.
// Returns Map<id, { col, cols }> where col is 0-based index and cols is total concurrent columns.
function computeDayLayout(events) {
  const sorted = [...events].sort((a, b) => a.hour - b.hour);
  const colEnds = []; // colEnds[i] = end time of last event placed in column i
  const result  = new Map();

  for (const evt of sorted) {
    const start = evt.hour;
    const end   = start + (evt.duration || 1);
    let c = colEnds.findIndex(e => e <= start);
    if (c === -1) c = colEnds.length;
    colEnds[c] = end;
    result.set(evt.id, { col: c });
  }

  // For each event, cols = max(col index + 1) among all events that overlap it
  for (const evt of sorted) {
    const start = evt.hour;
    const end   = start + (evt.duration || 1);
    let maxCol  = result.get(evt.id).col;
    for (const other of sorted) {
      const os = other.hour;
      const oe = os + (other.duration || 1);
      if (os < end && oe > start) maxCol = Math.max(maxCol, result.get(other.id).col);
    }
    result.get(evt.id).cols = maxCol + 1;
  }

  return result;
}

function positionCard(card, evt, colIdx = 0, totalCols = 1) {
  if (evt.hour == null) return;
  const offset = evt.hour - START_HOUR;
  const dur    = evt.duration || 1;
  card.style.top    = `calc(var(--day-header-h) + ${offset} * var(--hour-height))`;
  card.style.height = `calc(${dur} * var(--hour-height) - 4px)`;

  if (totalCols > 1) {
    const pct        = 100 / totalCols;
    card.style.left  = `calc(${colIdx * pct}% + 2px)`;
    card.style.width = `calc(${pct}% - 4px)`;
    card.style.right = 'unset';
  } else {
    card.style.left  = '';
    card.style.width = '';
    card.style.right = '';
  }
}

// Scroll the calendar so that `hour` is vertically centered in the viewport.
function scrollToHour(hour) {
  requestAnimationFrame(() => {
    const hh     = getHourHeight();
    const target = getDayHeaderH() + (hour - START_HOUR) * hh - calContainer.clientHeight / 2;
    calScroll.scrollTop = Math.max(0, target);
  });
}

function repositionAllCards() {
  // Cards auto-reposition via CSS calc; only travel indicators need a refresh.
  document.querySelectorAll('.travel-indicator').forEach(el => el.remove());
  renderTravelTimes();
}

function makeEventCard(evt) {
  const card = document.createElement('div');
  card.className  = `event-card cat-${evt.category}`;
  card.draggable  = true;
  card.dataset.id = evt.id;

  if (!eventMatchesView(evt)) card.classList.add('filtered-out');

  if (/\[tbd\]/i.test(evt.title)) {
    card.classList.add('bracket-tbd');
  } else if (/\[.+\]/.test(evt.title)) {
    card.classList.add('bracket-note');
  }

  const editBtn = document.createElement('button');
  editBtn.className   = 'event-edit-btn';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openModal(evt.id); });

  const isCompact = (evt.duration || 1) < 1;

  const titleEl = document.createElement('div');
  titleEl.className = 'event-card-title';

  const titleText = document.createElement('span');
  titleText.textContent = evt.title;
  titleEl.appendChild(titleText);

  // For compact cards: show pin inline in the title row, skip the meta entirely
  if (isCompact && evt.location?.lat != null) {
    const pin = document.createElement('span');
    pin.style.cssText = 'font-size:10px;opacity:0.6;margin-left:4px;flex-shrink:0;';
    pin.textContent   = '📍';
    titleEl.appendChild(pin);
  }

  const meta = document.createElement('div');
  meta.className = 'event-card-meta';

  if (!isCompact) {
    if (evt.hour != null) {
      const tEl = document.createElement('span');
      tEl.className   = 'event-time-label';
      tEl.textContent = `${formatHour(evt.hour)}–${formatHour(evt.hour + (evt.duration || 1))}`;
      meta.appendChild(tEl);
    }

    if (evt.people && evt.people.length) {
      const ppl = document.createElement('div');
      ppl.className = 'event-people-initials';
      evt.people.forEach(p => {
        const init = document.createElement('div');
        init.className = `person-initial pi-${p}`;
        init.textContent = p[0].toUpperCase();
        init.title = PEOPLE_LABEL[p] || p;
        ppl.appendChild(init);
      });
      meta.appendChild(ppl);
    }

    if (evt.hasReservation) {
      const res = document.createElement('span');
      res.className   = 'event-has-res';
      res.textContent = 'RES';
      meta.appendChild(res);
    }

    if (evt.location?.lat != null) {
      const pin = document.createElement('span');
      pin.style.cssText = 'font-size:10px;opacity:0.6;';
      pin.textContent   = '📍';
      meta.appendChild(pin);
    }

    // Show "Closed" badge if we have hours data and the event time falls outside them
    if (evt.placeInfo?.hours?.periods?.length && evt.day != null && evt.hour != null && state.startDate) {
      const base = parseLocalDate(state.startDate);
      base.setDate(base.getDate() + evt.day - 1);
      const dow    = base.getDay();
      const status = hoursStatusAt(evt.placeInfo.hours.periods, dow, evt.hour);
      if (!status.open) {
        const badge = document.createElement('span');
        badge.className   = 'evt-closed-badge';
        badge.textContent = status.closedToday ? 'Closed today' : 'Closed';
        meta.appendChild(badge);
      }
    }
  }

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resize-handle';
  resizeHandle.addEventListener('mousedown', e => {
    e.stopPropagation();
    e.preventDefault();
    const startY   = e.clientY;
    const startDur = evt.duration || 1;
    const hh       = getHourHeight();
    document.body.style.cursor = 'ns-resize';
    card.draggable = false;

    function onMove(me) {
      const deltaDur = (me.clientY - startY) / hh;
      // Snap to nearest 0.5hr, minimum 0.5hr
      const newDur = Math.max(0.5, Math.round((startDur + deltaDur) * 2) / 2);
      evt.duration = newDur;
      card.style.height = `calc(${newDur} * var(--hour-height) - 4px)`;
    }
    function onUp() {
      document.body.style.cursor = '';
      card.draggable = true;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      save();
      renderTravelTimes();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  card.append(editBtn, titleEl, meta, resizeHandle);
  card.addEventListener('dragstart', onDragStart);
  card.addEventListener('dragend',   onDragEnd);
  // Allow dropping onto occupied slots: pass dragover up to the day column.
  card.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  return card;
}

function renderUnscheduled() {
  pool.innerHTML = '';
  // "Unscheduled" = no time set (may or may not have a day)
  const unscheduled = state.events.filter(e => e.hour == null);
  usCount.textContent = unscheduled.length;

  if (unscheduled.length === 0) {
    const hint = document.createElement('span');
    hint.style.cssText  = 'font-size:12px;color:var(--text-muted);opacity:0.4;';
    hint.textContent    = 'No unscheduled events';
    pool.appendChild(hint);
    return;
  }

  unscheduled.forEach(evt => {
    const chip = document.createElement('div');
    chip.className  = `event-chip${eventMatchesView(evt) ? '' : ' dimmed'}`;
    chip.draggable  = true;
    chip.dataset.id = evt.id;

    const dot = document.createElement('span');
    dot.className = `chip-dot cat-dot-${evt.category}`;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(evt.title));

    // If a day is assigned but no time, show a small day tag
    if (evt.day != null) {
      const lbl = getDayLabel(evt.day);
      const tag = document.createElement('span');
      tag.style.cssText = 'margin-left:5px;font-size:10px;opacity:0.55;';
      tag.textContent   = `${lbl.dow} ${lbl.date}`;
      chip.appendChild(tag);
    }

    chip.addEventListener('dragstart', onDragStart);
    chip.addEventListener('dragend',   onDragEnd);
    chip.addEventListener('dblclick',  () => openModal(evt.id));
    pool.appendChild(chip);
  });
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

let drag = { id: null, placeholder: null, targetHour: null, targetDay: null };

// Compute the snapped hour (0.5 increments) from a clientY position over a day column.
function hourFromClientY(dayCol, clientY) {
  const rect = dayCol.getBoundingClientRect();
  const hh   = getHourHeight();
  const relY = clientY - rect.top - getDayHeaderH();
  const raw  = START_HOUR + relY / hh;
  const snapped = Math.round(raw * 2) / 2; // snap to nearest 0.5 hr
  return Math.max(START_HOUR, Math.min(END_HOUR - 0.5, snapped));
}

function onDragStart(e) {
  drag.id = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.id);
  drag.placeholder = document.createElement('div');
  drag.placeholder.className = 'drop-placeholder';
  // Defer pointer-events change — applying it synchronously during dragstart
  // causes the browser to cancel the drag before it begins.
  setTimeout(() => document.body.classList.add('is-dragging'), 0);
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  drag.placeholder?.remove();
  drag.placeholder = null;
  drag.targetHour  = null;
  drag.targetDay   = null;
  document.body.classList.remove('is-dragging');
  document.querySelectorAll('.pool-area.drag-over').forEach(c => c.classList.remove('drag-over'));
  drag.id = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const dayCol = e.currentTarget; // now on the col, not the cell
  if (!drag.placeholder) return;

  const targetHour = hourFromClientY(dayCol, e.clientY);
  drag.targetHour  = targetHour;
  drag.targetDay   = parseInt(dayCol.dataset.day, 10);

  const evt    = state.events.find(ev => ev.id === drag.id);
  const dur    = evt?.duration || 1;
  const offset = targetHour - START_HOUR;

  drag.placeholder.style.top    = `calc(var(--day-header-h) + ${offset} * var(--hour-height))`;
  drag.placeholder.style.height = `calc(${dur} * var(--hour-height) - 4px)`;

  if (drag.placeholder.parentElement !== dayCol) {
    drag.placeholder.remove();
    dayCol.appendChild(drag.placeholder);
  }
}

function onDragLeave(e) {
  // Only clear if leaving the day column entirely
  if (!e.currentTarget.contains(e.relatedTarget)) {
    drag.placeholder?.remove();
    drag.targetHour = null;
    drag.targetDay  = null;
  }
}

function onDrop(e) {
  e.preventDefault();
  drag.placeholder?.remove();
  drag.placeholder = null;
  if (!drag.id || drag.targetHour == null) return;

  const evt = state.events.find(ev => ev.id === drag.id);
  if (!evt) return;
  evt.day  = drag.targetDay;
  evt.hour = drag.targetHour;
  save();
  render();
}

pool.addEventListener('dragover', e => { e.preventDefault(); pool.classList.add('drag-over'); });
pool.addEventListener('dragleave', e => { if (!pool.contains(e.relatedTarget)) pool.classList.remove('drag-over'); });
pool.addEventListener('drop', e => {
  e.preventDefault();
  pool.classList.remove('drag-over');
  if (!drag.id) return;
  const evt = state.events.find(ev => ev.id === drag.id);
  if (!evt) return;
  evt.day = null; evt.hour = null;
  save(); render();
});

// ── Travel times ─────────────────────────────────────────────────────────────

let showHomeTravel = localStorage.getItem('trip-show-home-travel') !== 'false';

const btnHomeTravelEl = document.getElementById('btn-home-travel');
function applyHomeTravelToggle() {
  btnHomeTravelEl.classList.toggle('is-on', showHomeTravel);
  btnHomeTravelEl.title = showHomeTravel ? 'Hide home distances' : 'Show home distances';
}
applyHomeTravelToggle();

btnHomeTravelEl.addEventListener('click', () => {
  showHomeTravel = !showHomeTravel;
  localStorage.setItem('trip-show-home-travel', showHomeTravel);
  applyHomeTravelToggle();
  // Remove existing home indicators and re-render
  document.querySelectorAll('[data-travel-key^="home-"]').forEach(el => el.remove());
  if (showHomeTravel) renderTravelTimes();
});

// Copy the horizontal position of an event card to a travel indicator,
// so that pills in multi-column layouts align with their associated event.
function matchCardHorizPos(indicator, col, evtId) {
  const card = col.querySelector(`[data-id="${evtId}"]`);
  if (!card || !card.style.left) return; // full-width default from CSS
  indicator.style.left  = card.style.left;
  indicator.style.width = card.style.width;
  indicator.style.right = 'unset';
}

function makeHomeTravelIndicator(col, key, topOffset, labelHtml, warn, evtId) {
  col.querySelector(`[data-travel-key="${key}"]`)?.remove();
  const ind = document.createElement('div');
  ind.className = 'travel-indicator';
  ind.dataset.travelKey = key;
  ind.style.top = `calc(var(--day-header-h) + ${topOffset} * var(--hour-height) - 10px)`;
  if (evtId) matchCardHorizPos(ind, col, evtId);
  const bdg = document.createElement('span');
  bdg.className = `travel-badge travel-badge-home${warn ? ' travel-badge-warn' : ''}`;
  bdg.innerHTML = labelHtml;
  ind.appendChild(bdg);
  col.appendChild(ind);
}

const OSRM_CACHE_KEY = 'trip-osrm-cache';

function osrmCache() {
  try { return JSON.parse(sessionStorage.getItem(OSRM_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function osrmCacheSet(key, val) {
  const c = osrmCache(); c[key] = val;
  sessionStorage.setItem(OSRM_CACHE_KEY, JSON.stringify(c));
}

// Straight-line distance fallback (Haversine), used when OSRM times out.
function haversineKm(from, to) {
  const R = 6371;
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180)
          * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getDrivingInfo(from, to, signal) {
  const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}->${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  const cached = osrmCache()[key];
  if (cached) return cached;

  try {
    const url = `${API_BASE}/api/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`;
    const res  = await fetch(url, { signal });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    console.log(`[travel] graphhopper ${key} → ${data.distKm.toFixed(2)}km | walk ${data.walkMin}m | drive ${data.driveMin}m`);
    osrmCacheSet(key, data);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    // Backend unreachable — fall back to Haversine estimate
    const distKm   = haversineKm(from, to) * 1.35;
    const walkMin  = Math.round(distKm / 4.5 * 60);
    const driveMin = Math.round(distKm / 25 * 60);
    const result   = { distKm, walkMin, driveMin, approx: true };
    console.log(`[travel] haversine fallback ${key} → ${distKm.toFixed(2)}km | walk ${walkMin}m | drive ${driveMin}m`);
    osrmCacheSet(key, result);
    return result;
  }
}

let _travelAbort = null;

// Render travel time indicators for back-to-back events on each day.
// "Back-to-back" = event B starts within 30 min of event A ending.
async function renderTravelTimes() {
  if (_travelAbort) _travelAbort.abort();
  _travelAbort = new AbortController();
  const signal = _travelAbort.signal;

  const n = getDayCount();
  if (n === 0) return;

  for (let day = 1; day <= n; day++) {
    if (signal.aborted) return;
    const col = daysArea.querySelector(`.day-col[data-day="${day}"]`);
    if (!col) continue;

    // Inject flight virtual events for home-travel distance calculation.
    // Arrival flights  → virtual event at arrival airport (→ show airport→home pill).
    // Departure flights → virtual event at departure airport (→ show home→airport pill).
    const flightVirtualEvents = (state.flights || [])
      .filter(f => flightDay(f) === day && flightMatchesView(f))
      .flatMap(f => {
        const isTripDeparture = f.departure?.tz === TRIP_TZ;
        if (isTripDeparture) {
          if (f.departure?.lat == null || f.depHourCDMX == null) return [];
          return [{ id: `__flight_dep_${f.id}`, _isDep: true, hour: f.depHourCDMX, duration: 0, location: { lat: f.departure.lat, lng: f.departure.lng } }];
        } else {
          if (f.arrival?.lat == null || f.arrHourCDMX == null) return [];
          return [{ id: `__flight_${f.id}`, _isDep: false, hour: f.arrHourCDMX, duration: 0, location: { lat: f.arrival.lat, lng: f.arrival.lng } }];
        }
      });

    const dayEvents = [
      ...state.events.filter(e => e.day === day && e.hour != null && e.location?.lat != null),
      ...flightVirtualEvents,
    ].sort((a, b) => a.hour - b.hour);

    for (let i = 0; i < dayEvents.length - 1; i++) {
      if (signal.aborted) return;
      const a = dayEvents[i];
      const b = dayEvents[i + 1];

      const aEndHour = a.hour + (a.duration ?? 1);
      const gap      = b.hour - aEndHour;
      if (gap > 0.5) continue; // more than 30 min gap — skip

      const info = await getDrivingInfo(a.location, b.location, signal);
      if (!info) continue;

      const { driveMin, walkMin, approx } = info;
      if (walkMin < 1) continue;

      const showWalk = walkMin <= 25;
      const isWarn   = walkMin > 10;
      const prefix   = approx ? '~' : '';
      const label    = showWalk
        ? `🚶 ${prefix}${walkMin}m · 🚗 ${prefix}${driveMin}m`
        : `🚗 ${prefix}${driveMin}m`;

      const midOffset = aEndHour - START_HOUR;

      const existingKey = `travel-${a.id}-${b.id}`;
      col.querySelector(`[data-travel-key="${existingKey}"]`)?.remove();

      const indicator = document.createElement('div');
      indicator.className = 'travel-indicator';
      indicator.dataset.travelKey = existingKey;
      indicator.style.top = `calc(var(--day-header-h) + ${midOffset} * var(--hour-height) - 10px)`;
      matchCardHorizPos(indicator, col, a.id);

      const badge = document.createElement('span');
      badge.className = `travel-badge${isWarn ? ' travel-badge-warn' : ''}`;
      badge.innerHTML = label;
      indicator.appendChild(badge);
      col.appendChild(indicator);
    }

    // ── Home distance indicators ──────────────────────────────────────────
    // For every event not back-to-back with a predecessor → show home → event.
    // For every event not back-to-back with a successor   → show event → home.
    if (!showHomeTravel || state.home?.lat == null || dayEvents.length === 0) continue;
    const home = state.home;

    for (const evt of dayEvents) {
      if (signal.aborted) return;

      const isFlightArrival  = evt.id.startsWith('__flight_') && !evt._isDep;
      const isFlightDeparture = evt._isDep === true;

      // Does any other event end within 30 min before this one starts?
      const hasPred = dayEvents.some(o =>
        o.id !== evt.id && (evt.hour - (o.hour + (o.duration ?? 1))) <= 0.5 && o.hour <= evt.hour
      );
      // Does any other event start within 30 min after this one ends?
      const hasSucc = dayEvents.some(o =>
        o.id !== evt.id && (o.hour - (evt.hour + (evt.duration ?? 1))) <= 0.5 && o.hour >= evt.hour
      );

      // Inbound arrivals: skip "🏠 →" (you just landed, you're not leaving from home)
      // Outbound departures: skip "→ 🏠" (you're leaving the city, not going back home)
      if (!hasPred && !isFlightArrival) {
        const info = await getDrivingInfo(home, evt.location, signal);
        if (info && !signal.aborted) {
          const { driveMin, walkMin, approx } = info;
          if (walkMin >= 1) {
            const prefix = approx ? '~' : '';
            const label  = walkMin <= 25
              ? `🏠 → 🚶 ${prefix}${walkMin}m · 🚗 ${prefix}${driveMin}m`
              : `🏠 → 🚗 ${prefix}${driveMin}m`;
            makeHomeTravelIndicator(col, `home-to-${evt.id}`, evt.hour - START_HOUR, label, walkMin > 10, evt.id);
          }
        }
      }

      if (!hasSucc && !isFlightDeparture) {
        if (signal.aborted) return;
        const info = await getDrivingInfo(evt.location, home, signal);
        if (info && !signal.aborted) {
          const { driveMin, walkMin, approx } = info;
          if (walkMin >= 1) {
            const prefix    = approx ? '~' : '';
            const label     = walkMin <= 25
              ? `🚶 ${prefix}${walkMin}m · 🚗 ${prefix}${driveMin}m → 🏠`
              : `🚗 ${prefix}${driveMin}m → 🏠`;
            // Use ?? 1 (not || 1) so duration=0 for flight arrivals places the
            // indicator right at arrival time, not 1 hour later.
            const endOffset = evt.hour + (evt.duration ?? 1) - START_HOUR;
            makeHomeTravelIndicator(col, `home-from-${evt.id}`, endOffset, label, walkMin > 10, evt.id);
          }
        }
      }
    }
  }
}

// ── Click empty cell ──────────────────────────────────────────────────────────

function onCellClick(e) {
  if (e.target !== e.currentTarget) return;
  openModal(null, { day: parseInt(e.currentTarget.dataset.day), hour: parseInt(e.currentTarget.dataset.hour) });
}

// ── View filter ───────────────────────────────────────────────────────────────

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    viewFilter = btn.dataset.view;
    filterBtns.forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
});

// ── Tab switching ─────────────────────────────────────────────────────────────

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b === btn));
    calendarView.classList.toggle('hidden',     activeTab !== 'calendar');
    mapView.classList.toggle('hidden',          activeTab !== 'map');
    mapLegend.classList.toggle('hidden',        activeTab !== 'map');
    calZoomControl.classList.toggle('hidden',   activeTab !== 'calendar');
    btnHomeTravelCtrl.classList.toggle('hidden', activeTab !== 'calendar');

    if (activeTab === 'map') {
      // Leaflet needs the container visible before init
      setTimeout(() => { initMap(); renderMapDayStrip(); renderMap(); }, 50);
    } else {
      // Recalculate layout after returning to calendar
      updateHourHeight();
      repositionAllCards();
      scrollToHour(17);
    }
  });
});

// ── Map day strip ─────────────────────────────────────────────────────────────

function renderMapDayStrip() {
  mapDayStrip.innerHTML = '';
  const n = getDayCount();

  // Always show "All" button
  const allBtn = document.createElement('button');
  allBtn.className   = `map-day-btn${mapDayFilter === null ? ' active' : ''}`;
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => { mapDayFilter = null; renderMapDayStrip(); renderMap(); });
  mapDayStrip.appendChild(allBtn);

  if (n === 0) return;

  for (let d = 1; d <= n; d++) {
    const lbl = getDayLabel(d);
    const btn = document.createElement('button');
    btn.className   = `map-day-btn${mapDayFilter === d ? ' active' : ''}`;
    btn.textContent = lbl.date ? `${lbl.dow} ${lbl.date}` : `Day ${d}`;
    btn.dataset.day = d;
    btn.addEventListener('click', () => { mapDayFilter = d; renderMapDayStrip(); renderMap(); });
    mapDayStrip.appendChild(btn);
  }
}

// ── Map ───────────────────────────────────────────────────────────────────────

const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR  = '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';

function initMap() {
  if (leafletMap) return;
  leafletMap = L.map('leaflet-map', {
    center: [19.4195, -99.1617], // Tabasco 261, Roma Norte, CDMX
    zoom:   14,
    zoomControl: true,
  });
  mapTileLayer = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, {
    attribution: TILE_ATTR, subdomains: 'abcd', maxZoom: 19,
  }).addTo(leafletMap);
}

function swapMapTiles() {
  if (!leafletMap || !mapTileLayer) return;
  mapTileLayer.setUrl(isDark ? TILE_DARK : TILE_LIGHT);
}

function renderMap() {
  if (!leafletMap) return;

  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  // Home marker
  if (state.home?.lat != null) {
    const homeIcon = L.divIcon({
      html: '<div class="home-marker-icon">🏠</div>',
      className: '',
      iconSize:   [30, 30],
      iconAnchor: [15, 15],
      popupAnchor:[0, -18],
    });
    const hm = L.marker([state.home.lat, state.home.lng], { icon: homeIcon });
    hm.bindPopup(`
      <div class="map-popup-title">Home Base</div>
      <div class="map-popup-meta">${escHtml(state.home.address || '')}</div>
    `);
    hm.addTo(leafletMap);
    mapMarkers.push(hm);
  }

  // Event markers
  const eventsWithCoords = state.events
    .filter(e =>
      e.location?.lat != null && e.location?.lng != null &&
      eventMatchesView(e) &&
      (mapDayFilter === null || e.day === mapDayFilter)
    )
    .sort((a, b) => {
      const dayA = a.day ?? Infinity;
      const dayB = b.day ?? Infinity;
      if (dayA !== dayB) return dayA - dayB;
      return (a.hour ?? Infinity) - (b.hour ?? Infinity);
    });

  eventsWithCoords.forEach((evt, idx) => {
    const color  = CAT_COLOR[evt.category] || CAT_COLOR.other;
    const num    = idx + 1;
    const icon   = L.divIcon({
      html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${num}</div>`,
      className: '',
      iconSize:   [26, 26],
      iconAnchor: [13, 13],
      popupAnchor:[0, -16],
    });
    const marker = L.marker([evt.location.lat, evt.location.lng], { icon });

    const dayLbl  = evt.day != null ? getDayLabel(evt.day) : null;
    const dayStr  = dayLbl ? `Day ${dayLbl.num} · ${dayLbl.dow} ${dayLbl.date}` : 'Unscheduled';
    const timeStr = evt.hour != null ? formatHour(evt.hour) : '';
    const people  = (evt.people || []).map(p => PEOPLE_LABEL[p] || p).join(', ');

    marker.bindPopup(`
      <div class="map-popup-title"><span class="map-popup-num">${num}.</span> ${escHtml(evt.title)}</div>
      <div class="map-popup-meta">
        ${dayStr}${timeStr ? ' · ' + timeStr : ''}<br>
        ${CAT_LABEL[evt.category] || evt.category}
        ${people ? '<br>' + people : ''}
        ${evt.location.address ? '<br><em>' + escHtml(evt.location.address) + '</em>' : ''}
      </div>
    `);

    marker.addTo(leafletMap);
    mapMarkers.push(marker);
  });

  const hasAnyMarker = mapMarkers.length > 0;
  mapNoCoordsEl.classList.toggle('hidden', hasAnyMarker);

  if (hasAnyMarker) {
    const group = L.featureGroup(mapMarkers);
    leafletMap.fitBounds(group.getBounds().pad(0.3));
  } else if (state.home == null) {
    // No home, no events: default to CDMX
    leafletMap.setView([19.4195, -99.1617], 14);
  }
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

// Try to extract lat/lng from a Google Maps URL or page source string.
function parseGoogleMapsUrl(str) {
  if (!str) return null;
  let m;
  // @lat,lng,zoom  (standard place URL)
  m = str.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // !3d{lat}!4d{lng}  (Google data encoding in share links)
  m = str.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // ?ll=lat,lng
  m = str.match(/[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // ?q=lat,lng
  m = str.match(/[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

// Resolve coordinates from any Google Maps URL, including short links.
// maps.app.goo.gl uses HTTP + JS redirects; allorigins returns the HTML body
// which contains the real destination in a meta-refresh or JS redirect tag.
async function resolveGoogleMapsCoords(url) {
  if (!url) return null;

  // Non-short URL: parse directly
  if (!/goo\.gl|maps\.app\.goo\.gl/i.test(url)) {
    return parseGoogleMapsUrl(url);
  }

  try {
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res   = await fetch(proxy);
    const data  = await res.json();
    const body  = data?.contents || '';

    // 1. Direct scan of body for coordinate patterns (works if allorigins
    //    follows HTTP redirects and returns the final Maps page)
    const fromBody = parseGoogleMapsUrl(body);
    if (fromBody) return fromBody;

    // 2. Extract the redirect target from a meta-refresh tag:
    //    <meta http-equiv="refresh" content="0; url=https://...">
    const metaUrl = body.match(/content=["']\d+;\s*url=([^"']+)["']/i)?.[1];
    if (metaUrl) {
      const fromMeta = parseGoogleMapsUrl(decodeURIComponent(metaUrl));
      if (fromMeta) return fromMeta;
    }

    // 3. Extract from a JS redirect: window.location = "..." or location.href = "..."
    const jsUrl = body.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/)?.[1];
    if (jsUrl) {
      const fromJs = parseGoogleMapsUrl(decodeURIComponent(jsUrl));
      if (fromJs) return fromJs;
    }

    // 4. Any full Google Maps URL embedded anywhere in the HTML
    const embedded = body.match(/https:\/\/(?:www\.)?google\.com\/maps\/[^\s"'\\<>]+/)?.[0];
    if (embedded) {
      const fromEmbedded = parseGoogleMapsUrl(decodeURIComponent(embedded));
      if (fromEmbedded) return fromEmbedded;
    }

    return null;
  } catch {
    return null;
  }
}

// Geocode a free-text address via Nominatim (OSM, no API key required).
// Tries progressively simplified variants to handle abbreviations and local formatting.
async function geocodeAddress(text) {
  const normalize = s => s
    .replace(/\bNte\b\.?/gi, 'Norte')
    .replace(/\bSur\b/gi, 'Sur')
    .replace(/\bOte\b\.?/gi, 'Oriente')
    .replace(/\bPte\b\.?/gi, 'Poniente')
    .replace(/\bCDMX\b/gi, 'Ciudad de México')
    .replace(/\bCol\b\.?/gi, 'Colonia')
    .trim();

  const parts = text.split(',').map(s => s.trim()).filter(Boolean);

  const queries = [
    normalize(text),
    // street + colonia + city
    parts.length >= 3 ? normalize([parts[0], parts[1], 'Ciudad de México, Mexico'].join(', ')) : null,
    // just street + city
    parts.length >= 1 ? normalize([parts[0], 'Ciudad de México, Mexico'].join(', ')) : null,
  ].filter(Boolean);

  for (const q of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=mx`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data.length) {
      return {
        lat:     parseFloat(data[0].lat),
        lng:     parseFloat(data[0].lon),
        address: data[0].display_name,
      };
    }
  }
  return null;
}

btnLocate.addEventListener('click', () => resolvePlace(evtPlace.value.trim()));

async function resolvePlace(val) {
  if (!val) return;
  btnLocate.classList.add('loading');
  locStatus.className   = 'location-status info';
  currentLocationData   = null;

  try {
    if (isGoogleMapsUrl(val)) {
      // For Maps URLs, the backend returns name + coords + hours.
      // fetchAndShowPlaceInfo sets currentPlaceInfo and calls renderPlaceInfoPanel.
      locStatus.textContent = 'Looking up place…';
      await fetchAndShowPlaceInfo(val);
      if (currentPlaceInfo?.lat != null) {
        currentLocationData = { lat: currentPlaceInfo.lat, lng: currentPlaceInfo.lng, address: currentPlaceInfo.address };
        locStatus.className   = 'location-status ok';
        locStatus.textContent = currentPlaceInfo.name;
      } else if (!currentPlaceInfo) {
        locStatus.className   = 'location-status err';
        locStatus.textContent = 'Place not found. Try the full Google Maps URL.';
      }
    } else {
      // Plain address — geocode via Nominatim
      locStatus.textContent = 'Geocoding…';
      const result = await geocodeAddress(val);
      if (result) {
        currentLocationData = { ...result, address: val };
        locStatus.className   = 'location-status ok';
        locStatus.textContent = `Found: ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
      } else {
        locStatus.className   = 'location-status err';
        locStatus.textContent = 'Location not found. Try a more specific address.';
      }
      currentPlaceInfo = null;
      placeInfoEl.classList.add('hidden');
    }
  } catch {
    currentLocationData = null;
    locStatus.className   = 'location-status err';
    locStatus.textContent = 'Lookup failed. Check your connection.';
  } finally {
    btnLocate.classList.remove('loading');
  }
}

// ── Place info (Google Maps → hours/rating via backend) ───────────────────────

function isGoogleMapsUrl(str) {
  return /google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(str);
}

// Given Google Places periods and a JS day-of-week (0=Sun) + hour (int),
// return { open: bool, closedToday: bool, closesAt: "HH:MM" | null, opensAt: "HH:MM" | null }
function hoursStatusAt(periods, dowJS, hour) {
  for (const p of periods) {
    if (p.open.day !== dowJS) continue;
    const openH = parseInt(p.open.time.slice(0, 2), 10);
    const openM = parseInt(p.open.time.slice(2, 4), 10);
    let closeH, closeM;
    if (!p.close) {
      closeH = 24; closeM = 0;
    } else if (p.close.day !== p.open.day) {
      // Closes after midnight (next calendar day) — add 24 so comparison works
      // e.g. close.time "0200" → closeH = 26, meaning 2 AM next day
      closeH = parseInt(p.close.time.slice(0, 2), 10) + 24;
      closeM = parseInt(p.close.time.slice(2, 4), 10);
    } else {
      closeH = parseInt(p.close.time.slice(0, 2), 10);
      closeM = parseInt(p.close.time.slice(2, 4), 10);
    }
    if (hour * 60 >= openH * 60 + openM && hour * 60 < closeH * 60 + closeM) {
      // For display, unwrap the +24 offset back to real clock hour
      const displayH = p.close ? (closeH >= 24 ? closeH - 24 : closeH) : null;
      return { open: true, closedToday: false, closesAt: displayH != null ? formatHour(displayH) : null };
    }
  }
  // Find next open window to report "opens at"
  const todayPeriods = periods.filter(p => p.open.day === dowJS);
  if (todayPeriods.length) {
    const next = todayPeriods.sort((a, b) => parseInt(a.open.time) - parseInt(b.open.time))[0];
    const oh = parseInt(next.open.time.slice(0, 2), 10);
    return { open: false, closedToday: false, opensAt: formatHour(oh) };
  }
  return { open: false, closedToday: true, opensAt: null };
}

let currentPlaceInfo = null; // set when a Maps link is resolved in the modal
let _placeDebounce   = null;

async function fetchAndShowPlaceInfo(url) {
  if (!isGoogleMapsUrl(url)) {
    placeInfoEl.classList.add('hidden');
    currentPlaceInfo = null;
    return;
  }

  placeInfoEl.className = 'place-info loading';

  try {
    const res  = await fetch(`${API_BASE}/api/place?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    currentPlaceInfo = data;
    // If backend returned geometry, use it as the authoritative location
    if (data.lat != null && data.lng != null) {
      currentLocationData = { lat: data.lat, lng: data.lng, address: data.address };
    }
    renderPlaceInfoPanel();
  } catch (err) {
    currentPlaceInfo = null;
    placeInfoEl.className = 'place-info';
    placeInfoEl.innerHTML = `<span style="color:var(--text-muted);font-style:italic;">⚠️ ${escHtml(err.message)}</span>`;
  }
}

// Re-render the place info panel — called on fetch completion AND when day/time selects change
function renderPlaceInfoPanel() {
  if (!currentPlaceInfo) { placeInfoEl.classList.add('hidden'); return; }

  const info = currentPlaceInfo;
  placeInfoEl.className = 'place-info';

  const ratingHtml = info.rating     != null ? `⭐ ${info.rating}` : '';
  const priceHtml  = info.priceLevel != null ? '$'.repeat(info.priceLevel) : '';
  const metaParts  = [ratingHtml, priceHtml].filter(Boolean).join(' · ');

  // ── Hours for the selected day ──
  let todayHoursHtml = '';
  let warningHtml    = '';
  let weekdayIdx     = null;

  const dayVal  = evtDay.value !== '' ? parseInt(evtDay.value, 10) : null;
  const hourVal = evtTime.value !== '' ? parseFloat(evtTime.value) : null;

  if (info.hours?.weekdayText?.length && dayVal != null && state.startDate) {
    const base = parseLocalDate(state.startDate);
    base.setDate(base.getDate() + dayVal - 1);
    const dow   = base.getDay(); // 0=Sun
    weekdayIdx  = (dow + 6) % 7; // weekday_text is Mon-indexed

    const dayHoursText = info.hours.weekdayText[weekdayIdx] ?? '';
    const hoursOnly    = dayHoursText.replace(/^[^:]+:\s*/, '');
    todayHoursHtml = `<div class="place-hours-day">🕐 ${escHtml(hoursOnly)}</div>`;

    if (hourVal != null && info.hours.periods?.length) {
      const status = hoursStatusAt(info.hours.periods, dow, hourVal);
      if (!status.open) {
        const hint = status.opensAt ? ` (opens ${status.opensAt})` : '';
        const msg  = status.closedToday ? 'Closed today' : `Closed at this time${hint}`;
        warningHtml = `<div class="place-hours-warn">⚠️ ${escHtml(msg)}</div>`;
      } else {
        const dur       = parseFloat(evtDuration.value) || 1;
        const endStatus = hoursStatusAt(info.hours.periods, dow, Math.floor(hourVal + dur));
        if (!endStatus.open && status.closesAt) {
          warningHtml = `<div class="place-hours-soft-warn">⚠️ May close before event ends (closes ${escHtml(status.closesAt)})</div>`;
        }
      }
    }
  }

  // ── Full week hours (collapsible) ──
  let allHoursHtml = '';
  if (info.hours?.weekdayText?.length) {
    const rows = info.hours.weekdayText.map((line, i) => {
      const isToday = i === weekdayIdx;
      return `<div class="place-hours-row${isToday ? ' place-hours-today' : ''}">${escHtml(line)}</div>`;
    }).join('');
    allHoursHtml = `
      <details class="place-hours-details">
        <summary>All hours</summary>
        <div class="place-hours-week">${rows}</div>
      </details>`;
  }

  placeInfoEl.innerHTML = `
    <div class="place-info-row">
      <span class="place-info-name">${escHtml(info.name)}</span>
      ${info.typeLabel ? `<span class="place-info-type">${escHtml(info.typeLabel)}</span>` : ''}
      ${metaParts ? `<span class="place-info-meta">${escHtml(metaParts)}</span>` : ''}
    </div>
    ${todayHoursHtml}
    ${warningHtml}
    ${allHoursHtml}
  `;
}

// Auto-trigger for Maps URLs pasted into the field; plain addresses require the 📍 button
evtPlace.addEventListener('input', () => {
  const val = evtPlace.value.trim();
  if (isGoogleMapsUrl(val)) {
    clearTimeout(_placeDebounce);
    _placeDebounce = setTimeout(() => resolvePlace(val), 600);
  } else {
    // Clear stale place info when user edits to a non-URL value
    currentPlaceInfo = null;
    placeInfoEl.classList.add('hidden');
  }
});

// Re-check hours when day or time changes (no re-fetch needed)
evtDay.addEventListener('change', renderPlaceInfoPanel);
evtTime.addEventListener('change', renderPlaceInfoPanel);
evtDuration.addEventListener('change', renderPlaceInfoPanel);

// ── Modal ─────────────────────────────────────────────────────────────────────

let editingId           = null;
let currentLocationData = null; // { lat, lng, address } set by locate button
let _modalPlaceInfo     = null; // placeInfo to persist when saving

function populateDayOptions() {
  while (evtDay.options.length > 1) evtDay.remove(1);
  const n = getDayCount();
  for (let d = 1; d <= n; d++) {
    const lbl = getDayLabel(d);
    evtDay.appendChild(new Option(`Day ${lbl.num} · ${lbl.dow} ${lbl.date}`, d));
  }
}

function populateTimeOptions() {
  evtTime.innerHTML = '<option value="">— no time —</option>';
  for (let h = START_HOUR; h < START_HOUR + N_HOURS; h += 0.5) {
    evtTime.appendChild(new Option(formatHour(h), h));
  }
}

function openModal(id = null, prefill = {}) {
  editingId           = id;
  currentLocationData = null;
  _modalPlaceInfo     = null;
  currentPlaceInfo    = null;
  placeInfoEl.classList.add('hidden');
  populateDayOptions();
  populateTimeOptions();
  locStatus.textContent = '';
  locStatus.className   = 'location-status';

  if (id) {
    const evt = state.events.find(e => e.id === id);
    modalTitle.textContent = 'Edit Event';
    evtTitle.value         = evt.title || '';
    evtCategory.value      = evt.category || 'food';
    evtDay.value           = evt.day != null ? evt.day : '';
    evtTime.value          = evt.hour != null ? evt.hour : '';
    evtDuration.value      = evt.duration || 1;
    // Prefer showing the Maps URL (most informative); fall back to saved address
    evtPlace.value         = evt.link || evt.location?.address || '';
    evtNotes.value         = evt.notes || '';
    if (evt.placeInfo) { currentPlaceInfo = evt.placeInfo; renderPlaceInfoPanel(); }
    else if (evt.link && isGoogleMapsUrl(evt.link)) fetchAndShowPlaceInfo(evt.link);
    evtRes.value           = evt.reservationDetails || '';
    resYes.checked         = !!evt.hasReservation;
    resNo.checked          = !evt.hasReservation;
    resGroup.classList.toggle('hidden', !evt.hasReservation);
    peopleChips.forEach(c => c.classList.toggle('selected', (evt.people || []).includes(c.dataset.person)));
    if (evt.location?.lat != null) {
      currentLocationData   = evt.location;
      locStatus.className   = 'location-status ok';
      locStatus.textContent = `Saved: ${evt.location.lat.toFixed(5)}, ${evt.location.lng.toFixed(5)}`;
    }
    modalDelete.classList.remove('hidden');
  } else {
    modalTitle.textContent = 'Add Event';
    evtTitle.value         = '';
    evtCategory.value      = 'food';
    evtDay.value           = prefill.day != null ? prefill.day : '';
    evtTime.value          = prefill.hour != null ? prefill.hour : '';
    evtDuration.value      = 1;
    evtPlace.value         = '';
    evtNotes.value         = '';
    evtRes.value           = '';
    resNo.checked          = true;
    resGroup.classList.add('hidden');
    peopleChips.forEach(c => c.classList.remove('selected'));
    modalDelete.classList.add('hidden');
  }

  modalOverlay.classList.remove('hidden');
  setTimeout(() => evtTitle.focus(), 50);
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  editingId = null;
  currentLocationData = null;
}

peopleChips.forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('selected')));
[resNo, resYes].forEach(r => r.addEventListener('change', () => resGroup.classList.toggle('hidden', !resYes.checked)));
modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
modalOverlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') modalSave.click();
});

modalSave.addEventListener('click', () => {
  const title = evtTitle.value.trim();
  if (!title) { evtTitle.focus(); return; }

  const people  = [...peopleChips].filter(c => c.classList.contains('selected')).map(c => c.dataset.person);
  const dayVal  = evtDay.value !== ''  ? parseInt(evtDay.value, 10)  : null;
  const hourVal = evtTime.value !== '' ? parseFloat(evtTime.value) : null;

  const fields = {
    title,
    category: evtCategory.value,
    day: dayVal, hour: hourVal,
    duration: parseFloat(evtDuration.value) || 1,
    location: currentLocationData || (editingId ? (state.events.find(e => e.id === editingId)?.location || null) : null),
    link: isGoogleMapsUrl(evtPlace.value.trim()) ? evtPlace.value.trim() : '',
    placeInfo: currentPlaceInfo || (editingId ? (state.events.find(e => e.id === editingId)?.placeInfo ?? null) : null),
    notes: evtNotes.value.trim(),
    people,
    hasReservation: resYes.checked,
    reservationDetails: resYes.checked ? evtRes.value.trim() : '',
  };

  if (editingId) {
    Object.assign(state.events.find(e => e.id === editingId), fields);
  } else {
    state.events.push({ id: uid(), ...fields });
  }

  save(); closeModal(); render();
});

modalDelete.addEventListener('click', () => {
  if (!editingId) return;
  state.events = state.events.filter(e => e.id !== editingId);
  save(); closeModal(); render();
});

// ── Unscheduled bar toggle ────────────────────────────────────────────────────

toggleUs.addEventListener('click', () => {
  usBar.classList.toggle('open');
  updateHourHeight();
  repositionAllCards();
});

// ── Header controls ───────────────────────────────────────────────────────────

tripNameEl.addEventListener('input', () => {
  state.tripName = tripNameEl.value;
  document.title = (state.tripName || 'My Trip') + ' — Trip Planner';
  save();
});

startDateEl.addEventListener('change', () => {
  state.startDate = startDateEl.value;
  if (state.endDate && state.endDate < state.startDate) { state.endDate = state.startDate; endDateEl.value = state.startDate; }
  const n = getDayCount();
  state.events.forEach(e => { if (e.day != null && e.day > n) { e.day = null; e.hour = null; } });
  save(); render();
});

endDateEl.addEventListener('change', () => {
  state.endDate = endDateEl.value;
  const n = getDayCount();
  state.events.forEach(e => { if (e.day != null && e.day > n) { e.day = null; e.hour = null; } });
  save(); render();
});

btnAddEvent.addEventListener('click', () => openModal());

// ── Resize ────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  updateHourHeight();
  repositionAllCards();
  updateColumnWidths();
  if (leafletMap) leafletMap.invalidateSize();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Home base ────────────────────────────────────────────────────────────────

let pendingHomeLocation = null;

function updateHomeButton() {
  const hasHome = state.home?.lat != null;
  btnHome.classList.toggle('is-set', hasHome);
  homeLabel.textContent = hasHome
    ? (state.home.address?.split(',')[0] || 'Home set')
    : 'Set home';
}

btnHome.addEventListener('click', () => {
  pendingHomeLocation    = state.home ? { ...state.home } : null;
  homeAddressEl.value    = state.home?.address || '';
  homeLocStatus.textContent = '';
  homeLocStatus.className   = 'location-status';
  if (state.home?.lat != null) {
    homeLocStatus.className   = 'location-status ok';
    homeLocStatus.textContent = `Saved: ${state.home.lat.toFixed(5)}, ${state.home.lng.toFixed(5)}`;
  }
  homeModalClear.classList.toggle('hidden', !state.home);
  homeModalOverlay.classList.remove('hidden');
  setTimeout(() => homeAddressEl.focus(), 50);
});

btnHomeLocate.addEventListener('click', async () => {
  btnHomeLocate.classList.add('loading');
  homeLocStatus.className   = 'location-status info';
  homeLocStatus.textContent = 'Searching…';
  const val = homeAddressEl.value.trim();
  if (!val) {
    homeLocStatus.className   = 'location-status err';
    homeLocStatus.textContent = 'Enter an address or paste a Google Maps link.';
    btnHomeLocate.classList.remove('loading');
    return;
  }
  try {
    if (/goo\.gl|maps\.app\.goo\.gl/i.test(val)) homeLocStatus.textContent = 'Expanding short URL…';
    const fromUrl = await resolveGoogleMapsCoords(val);
    if (fromUrl) {
      pendingHomeLocation       = { ...fromUrl, address: val };
      homeLocStatus.className   = 'location-status ok';
      homeLocStatus.textContent = `Found: ${fromUrl.lat.toFixed(5)}, ${fromUrl.lng.toFixed(5)}`;
      return;
    }
    homeLocStatus.textContent = 'Geocoding address…';
    const result = await geocodeAddress(val);
    if (result) {
      pendingHomeLocation       = { ...result, address: homeAddressEl.value.trim() };
      homeLocStatus.className   = 'location-status ok';
      homeLocStatus.textContent = `Found: ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
    } else {
      pendingHomeLocation       = null;
      homeLocStatus.className   = 'location-status err';
      homeLocStatus.textContent = 'Location not found. Try a more specific address.';
    }
  } catch {
    homeLocStatus.className   = 'location-status err';
    homeLocStatus.textContent = 'Geocoding failed. Check your connection.';
  } finally {
    btnHomeLocate.classList.remove('loading');
  }
});

homeModalSave.addEventListener('click', () => {
  if (pendingHomeLocation) {
    state.home = { ...pendingHomeLocation, address: homeAddressEl.value.trim() || pendingHomeLocation.address };
  } else if (homeAddressEl.value.trim()) {
    // Saved address text without geocoding — store text only, no coords yet
    state.home = { address: homeAddressEl.value.trim(), lat: null, lng: null };
  }
  save();
  updateHomeButton();
  homeModalOverlay.classList.add('hidden');
  if (activeTab === 'map') renderMap();
});

homeModalClear.addEventListener('click', () => {
  state.home = null;
  save();
  updateHomeButton();
  homeModalOverlay.classList.add('hidden');
  if (activeTab === 'map') renderMap();
});

homeModalCancel.addEventListener('click', () => homeModalOverlay.classList.add('hidden'));
homeModalOverlay.addEventListener('click', e => { if (e.target === homeModalOverlay) homeModalOverlay.classList.add('hidden'); });
homeModalOverlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') homeModalOverlay.classList.add('hidden');
  if (e.key === 'Enter')  homeModalSave.click();
});

// ── Flights ───────────────────────────────────────────────────────────────────

const flightModalOverlay = document.getElementById('flight-modal-overlay');
const flightModalTitle   = document.getElementById('flight-modal-title');
const fltNumber          = document.getElementById('flt-number');
const fltDate            = document.getElementById('flt-date');
const fltPeopleChips     = document.querySelectorAll('#flt-people-chips .person-chip');
const fltLookup          = document.getElementById('flt-lookup');
const fltStatus          = document.getElementById('flt-status');
const fltResults         = document.getElementById('flt-results');
const fltDelete          = document.getElementById('flt-delete');
const fltCancel          = document.getElementById('flt-cancel');
const fltSave            = document.getElementById('flt-save');

let fltSelectedResult = null;  // the flight object chosen from lookup results
let fltEditingId      = null;  // id of flight being edited (null = new)

function openFlightModal(id = null) {
  fltEditingId      = id;
  fltSelectedResult = null;
  fltResults.innerHTML = '';
  fltResults.classList.add('hidden');
  fltStatus.textContent = '';
  fltSave.classList.add('hidden');
  fltDelete.classList.toggle('hidden', !id);
  flightModalTitle.textContent = id ? 'Edit Flight' : 'Add Flight';

  if (id) {
    const f = (state.flights || []).find(x => x.id === id);
    if (f) {
      fltNumber.value = f.number;
      fltDate.value   = f.date;
      fltPeopleChips.forEach(c => c.classList.toggle('active', (f.people || []).includes(c.dataset.person)));
      fltSelectedResult = f;
      // depHourCDMX is already stored in CDMX time, so label both as CDMX
      fltDepTzEl.textContent = '(CDMX time)';
      fltDepTime.value  = f.depHourCDMX != null ? hourToTimeStr(f.depHourCDMX) : '';
      fltArrTime.value  = f.arrHourCDMX != null ? hourToTimeStr(f.arrHourCDMX) : '';
      fltTimesEl.classList.remove('hidden');
      fltSave.classList.remove('hidden');
      fltSave.textContent = 'Save Changes';
    }
  } else {
    fltNumber.value = '';
    fltDate.value   = state.startDate || '';
    fltSave.textContent = 'Add Flight';
    fltPeopleChips.forEach(c => c.classList.remove('active'));
    fltDepTime.value = '';
    fltArrTime.value = '';
    fltTimesEl.classList.add('hidden');
  }

  flightModalOverlay.classList.remove('hidden');
  fltNumber.focus();
}

fltPeopleChips.forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('active'));
});

fltLookup.addEventListener('click', async () => {
  const num  = fltNumber.value.trim();
  const date = fltDate.value;
  if (!num || !date) { fltStatus.textContent = 'Enter a flight number and date first.'; return; }

  fltStatus.className   = 'location-status';
  fltStatus.textContent = 'Looking up…';
  fltResults.innerHTML  = '';
  fltResults.classList.add('hidden');
  fltTimesEl.classList.add('hidden');
  fltSave.classList.add('hidden');
  fltSelectedResult = null;

  try {
    const resp = await fetch(`${API_BASE}/api/flight?number=${encodeURIComponent(num)}&date=${encodeURIComponent(date)}`);
    const data = await resp.json();
    if (!resp.ok) {
      fltStatus.className   = 'location-status err';
      fltStatus.textContent = data.error || 'Lookup failed.';
      return;
    }

    fltStatus.textContent = '';
    const { flights } = data;

    if (flights.length === 1) {
      // Auto-select if only one result
      selectFlightResult(flights[0]);
    } else {
      // Show list to pick from
      fltResults.innerHTML = '';
      flights.forEach(f => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'flt-result-item';
        item.innerHTML = `
          <span class="flt-result-num">${escHtml(f.number)}</span>
          <span class="flt-result-route">${escHtml(f.departure.iata || '?')} → ${escHtml(f.arrival.iata || '?')}</span>
          <span class="flt-result-times">${formatIsoForDisplay(f.departure.time)} → ${formatIsoForDisplay(f.arrival.time, true)}</span>
          <span class="flt-result-airline">${escHtml(f.airline)}</span>
        `;
        item.addEventListener('click', () => {
          fltResults.querySelectorAll('.flt-result-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          selectFlightResult(f);
        });
        fltResults.appendChild(item);
      });
      fltResults.classList.remove('hidden');
    }
  } catch (err) {
    fltStatus.className   = 'location-status err';
    fltStatus.textContent = 'Network error — is the server running?';
  }
});

const fltTimesEl  = document.getElementById('flt-times');
const fltDepTime  = document.getElementById('flt-dep-time');
const fltArrTime  = document.getElementById('flt-arr-time');
const fltDepTzEl  = document.querySelector('.flt-dep-tz');

function selectFlightResult(f) {
  fltSelectedResult = f;
  fltStatus.className   = 'location-status ok';
  fltStatus.textContent = `${f.departure.iata} → ${f.arrival.iata} · ${f.airline}`;

  // Show time inputs — pre-fill from API if times are available, else leave blank
  fltDepTzEl.textContent = f.departure.tz ? `(${f.departure.tz.split('/').pop().replace('_', ' ')})` : '(local)';
  fltDepTime.value = f.departure.time ? isoToTimeInput(f.departure.time, f.departure.tz) : '';
  fltArrTime.value = f.arrival.time   ? isoToTimeInput(f.arrival.time,   TRIP_TZ)        : '';
  fltTimesEl.classList.remove('hidden');
  fltSave.classList.remove('hidden');
}

// Convert an ISO datetime to "HH:MM" for <input type="time"> in the given timezone
function isoToTimeInput(isoStr, tz) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || TRIP_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const h = parts.find(p => p.type === 'hour')?.value   ?? '00';
    const m = parts.find(p => p.type === 'minute')?.value ?? '00';
    return `${h === '24' ? '00' : h}:${m}`;
  } catch { return ''; }
}

function timeInputToHour(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  return h + (m || 0) / 60;
}

function hourToTimeStr(h) {
  const hInt = Math.floor(h);
  const mInt = Math.round((h - hInt) * 60);
  return `${String(hInt).padStart(2,'0')}:${String(mInt).padStart(2,'0')}`;
}

// Build an ISO datetime by interpreting "HH:MM" as local time in the given IANA timezone.
// Returns an ISO string (e.g. "2026-04-22T15:00:00-04:00") or null if tz unknown.
function buildIsoInTz(dateStr, timeStr, tz) {
  if (!tz || !dateStr || !timeStr) return null;
  try {
    // Get the UTC offset for this timezone on this date by creating a
    // reference date and measuring its offset via Intl.
    const naive = new Date(`${dateStr}T${timeStr}:00`); // local browser time, wrong tz but good enough for offset lookup
    const utcMs = naive.getTime();
    // Use Intl to find what UTC time corresponds to "dateStr timeStr" in tz
    // Strategy: binary-search is complex; instead format a UTC date through the
    // target tz and compute the offset.
    const fmtUtc = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    // Find offset by comparing what Intl shows for a known UTC date
    const probe = new Date(`${dateStr}T12:00:00Z`);
    const probeLocal = fmtUtc.formatToParts(probe);
    const ph = parseInt(probeLocal.find(p=>p.type==='hour').value);
    const offsetH = ph - 12; // approximate offset in hours
    const isoOffset = offsetH >= 0 ? `+${String(offsetH).padStart(2,'0')}:00` : `-${String(Math.abs(offsetH)).padStart(2,'0')}:00`;
    return `${dateStr}T${timeStr}:00${isoOffset}`;
  } catch { return null; }
}

// Format an ISO datetime for display in CDMX time
function formatIsoForDisplay(isoStr, cdmxOnly = false) {
  if (!isoStr) return '?';
  try {
    const d = new Date(isoStr);
    // Show time in CDMX timezone
    const cdmx = d.toLocaleTimeString('en-US', { timeZone: TRIP_TZ, hour: 'numeric', minute: '2-digit', hour12: true });
    if (cdmxOnly) return cdmx + ' CDMX';
    // For departure show local departure time
    const local = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return local;
  } catch { return isoStr; }
}

fltSave.addEventListener('click', () => {
  if (!fltSelectedResult) return;

  const depHour = timeInputToHour(fltDepTime.value);
  const arrHour = timeInputToHour(fltArrTime.value);
  if (depHour == null || arrHour == null) {
    fltStatus.className   = 'location-status err';
    fltStatus.textContent = 'Enter departure and arrival times above.';
    return;
  }

  // For departure: convert from departure airport local time to CDMX time
  // We do this by constructing an ISO string with the departure timezone offset,
  // then reading it back in CDMX time using Intl.
  const depDate  = fltDate.value;
  const depIso   = buildIsoInTz(depDate, fltDepTime.value, fltSelectedResult.departure.tz);
  const depCDMX  = depIso ? toTripHour(depIso) : depHour; // fallback: treat as CDMX directly

  const people = [...fltPeopleChips].filter(c => c.classList.contains('active')).map(c => c.dataset.person);
  if (!state.flights) state.flights = [];

  const entry = {
    id:          fltEditingId || uid(),
    date:        fltDate.value,
    ...fltSelectedResult,
    people,          // after spread so chip selection always wins
    depHourCDMX: depCDMX,
    arrHourCDMX: arrHour,   // arrival time input is already in CDMX
  };

  if (fltEditingId) {
    const idx = state.flights.findIndex(f => f.id === fltEditingId);
    if (idx !== -1) state.flights[idx] = entry;
  } else {
    state.flights.push(entry);
  }

  save();
  render();
  flightModalOverlay.classList.add('hidden');
});

fltDelete.addEventListener('click', () => {
  if (!fltEditingId) return;
  state.flights = (state.flights || []).filter(f => f.id !== fltEditingId);
  save();
  render();
  flightModalOverlay.classList.add('hidden');
});

fltCancel.addEventListener('click', () => flightModalOverlay.classList.add('hidden'));
flightModalOverlay.addEventListener('click', e => { if (e.target === flightModalOverlay) flightModalOverlay.classList.add('hidden'); });

btnAddFlight.addEventListener('click', () => openFlightModal());

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme() {
  document.body.classList.toggle('light', !isDark);
  btnTheme.textContent = isDark ? '☀︎' : '☾';
  btnTheme.title       = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

btnTheme.addEventListener('click', () => {
  isDark = !isDark;
  localStorage.setItem('trip-theme', isDark ? 'dark' : 'light');
  applyTheme();
  swapMapTiles();
});

// ── Init ──────────────────────────────────────────────────────────────────────

applyTheme();

// Wire up sync status element and password gate events
syncStatusEl = document.getElementById('sync-status');

document.getElementById('password-submit').addEventListener('click', submitPassword);
document.getElementById('password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitPassword();
});
document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('trip-password');
  localStorage.removeItem('trip-password-ts');
  syncPassword = '';
  clearInterval(syncPollTimer);
  showPasswordGate();
});

// Bootstrap: render nothing until auth confirmed
(async () => {
  if (syncPassword) {
    const ok = await syncLoad();
    if (ok) {
      updateHomeButton();
      render();
      scrollToHour(17);
      startSyncPoll();
    }
    // if not ok, syncLoad already called showPasswordGate()
  } else {
    showPasswordGate();
  }
})();
