// ── Constants ─────────────────────────────────────────────────────────────────

// Backend API — local dev vs deployed. Update PROD_API_BASE when you deploy the server.
const IS_LOCAL    = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE    = IS_LOCAL ? 'http://localhost:3001' : 'https://grouptrip-phi.vercel.app';

// Which trip we're viewing — null means show the landing page.
const tripId = new URLSearchParams(window.location.search).get('trip');

const STORAGE_KEY = tripId ? `trip-planner-${tripId}` : 'trip-planner-v2';
const START_HOUR  = 0;
const END_HOUR    = 23;
const N_HOURS     = END_HOUR - START_HOUR + 1; // 24
const HOURS       = Array.from({ length: N_HOURS }, (_, i) => i + START_HOUR);
const FIXED_COL_W = 180; // px for >7 days

const CAT_COLOR    = { food: '#f97316', activity: '#22c55e', accommodation: '#3b82f6', transport: '#a855f7', other: '#64748b' };
const PERSON_COLORS = ['#f97316','#ec4899','#22c55e','#3b82f6','#a855f7','#eab308','#ef4444','#14b8a6','#f43f5e','#0ea5e9'];
const CAT_LABEL    = { food: 'Food & Drink', activity: 'Activity', accommodation: 'Stay', transport: 'Transport', other: 'Other' };

// ── State ─────────────────────────────────────────────────────────────────────

function defaultState() {
  return { tripName: 'My Trip', startDate: '', endDate: '', events: [], home: null, flights: [], people: [], homeDays: {}, destination: null };
}

// Run after loading state — adds new fields and migrates legacy hardcoded people.
function migrateState() {
  if (!state.flights)  state.flights  = [];
  if (!state.people)   state.people   = [];
  if (!state.homeDays) state.homeDays = {};
  if (!('destination' in state)) state.destination = null;
  delete state.groups; // no longer used

  // Legacy trips were all CDMX — if flights carry the old CDMX-only field names
  // and no destination is set yet, backfill it.
  if (state.destination == null && state.flights.some(f => f.depHourCDMX != null || f.arrHourCDMX != null)) {
    state.destination = { label: 'CDMX', tz: 'America/Mexico_City', lat: 19.4195, lng: -99.1617 };
  }
  for (const f of state.flights) {
    if (f.depHourCDMX != null) { f.depHourTrip = f.depHourCDMX; delete f.depHourCDMX; }
    if (f.arrHourCDMX != null) { f.arrHourTrip = f.arrHourCDMX; delete f.arrHourCDMX; }
  }

  // Legacy flights stored a single fractional hour per leg (no explicit date/tz
  // pairing) — synthesize full ISO datetimes from f.date + the trip timezone so
  // flightRenderInfo() has a single source of truth to work from. An arrival
  // hour earlier than the departure hour implies an overnight leg.
  for (const f of state.flights) {
    if (f.depIso == null && f.depHourTrip != null && f.date) {
      f.depIso = buildIsoInTz(f.date, hourToTimeStr(f.depHourTrip), tripTz());
    }
    if (f.arrIso == null && f.arrHourTrip != null && f.date) {
      const overnight = f.depHourTrip != null && f.arrHourTrip < f.depHourTrip;
      const arrDate   = overnight ? addDaysToDateStr(f.date, 1) : f.date;
      f.arrIso = buildIsoInTz(arrDate, hourToTimeStr(f.arrHourTrip), tripTz());
    }
    delete f.depHourTrip;
    delete f.arrHourTrip;
  }

  // If no people defined yet but events/flights reference old hardcoded IDs, auto-migrate.
  if (state.people.length === 0) {
    const allIds = new Set([
      ...state.events.flatMap(e => e.people || []),
      ...(state.flights || []).flatMap(f => f.people || []),
    ]);
    if (allIds.size > 0) {
      const legacyName  = { jay: 'Jay', abi: 'Abi', austin: 'Austin', johanna: 'Johanna' };
      const legacyColor = { jay: '#f97316', abi: '#ec4899', austin: '#22c55e', johanna: '#3b82f6' };
      for (const id of allIds) {
        if (!state.people.some(p => p.id === id))
          state.people.push({ id, name: legacyName[id] || id, color: legacyColor[id] || '#64748b' });
      }
    }
  }
  // Strip any leftover groupId fields
  for (const p of state.people) delete p.groupId;
}

// ── People helpers ────────────────────────────────────────────────────────────

function getPersonName(personId) {
  return (state.people || []).find(p => p.id === personId)?.name || personId;
}
function getPersonColor(personId) {
  return (state.people || []).find(p => p.id === personId)?.color || '#64748b';
}
function nextPersonColor() {
  const used = new Set((state.people || []).map(p => p.color));
  return PERSON_COLORS.find(c => !used.has(c)) || PERSON_COLORS[(state.people || []).length % PERSON_COLORS.length];
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || uid();
}

// ── Home helpers ──────────────────────────────────────────────────────────────

function getHomeForDay(day) {
  const override = state.homeDays?.[String(day)];
  if (override?.lat != null) return override;
  return state.home?.lat != null ? state.home : null;
}

let state = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState(); }
  catch { return defaultState(); }
})();
migrateState();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleSyncSave();
}
function uid()  { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

// ── API sync & auth ──────────────────────────────────────────────────────────

const SYNC_INTERVAL_MS = 15_000;
const PASSWORD_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Per-trip localStorage keys so multiple trips can be cached independently.
function pwKey()   { return `trip-password-${tripId}`; }
function pwTsKey() { return `trip-password-ts-${tripId}`; }

function loadStoredPassword() {
  if (!tripId) return '';
  const pw     = localStorage.getItem(pwKey()) || '';
  const tsRaw  = localStorage.getItem(pwTsKey());
  if (pw && !tsRaw) {
    localStorage.setItem(pwTsKey(), Date.now().toString());
    return pw;
  }
  const ts = parseInt(tsRaw || '0', 10);
  if (pw && Date.now() - ts < PASSWORD_TTL_MS) return pw;
  if (pw) { localStorage.removeItem(pwKey()); localStorage.removeItem(pwTsKey()); }
  return '';
}
let syncPassword   = loadStoredPassword();
let lastSyncedAt   = null;   // ISO string of the server's last updated_at we've applied
let syncSaveTimer  = null;
let syncPollTimer  = null;
let syncStatusEl   = null;   // set after DOM ready

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'X-Trip-Password': syncPassword, 'X-Trip-Id': tripId };
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
      migrateState();
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
        migrateState();
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
  localStorage.removeItem(pwKey());
  localStorage.removeItem(pwTsKey());
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
      headers: { 'Content-Type': 'application/json', 'X-Trip-Password': pw, 'X-Trip-Id': tripId },
    });
    if (res.status === 401) {
      errEl.textContent = 'Wrong password. Try again.';
      errEl.classList.remove('hidden');
      input.value = '';
      input.focus();
      return;
    }
    syncPassword = pw;
    localStorage.setItem(pwKey(), pw);
    localStorage.setItem(pwTsKey(), Date.now().toString());
    const { state: remote, updatedAt } = await res.json();
    if (remote) {
      state = remote;
      migrateState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    lastSyncedAt = updatedAt;
    hidePasswordGate();
    updateHomeButton();
    updateDestinationButton();
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
let agendaDay    = null;   // mobile agenda's selected day — lazily defaulted to "today" on first render

const mobileMQ = window.matchMedia('(max-width: 640px)');
function isMobile() { return mobileMQ.matches; }

// Default agendaDay to today (if within the trip's range) else day 1.
function defaultAgendaDay() {
  if (state.startDate) {
    const today = new Date();
    const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - parseLocalDate(state.startDate)) / 86400000) + 1;
    if (diff >= 1 && diff <= getDayCount()) return diff;
  }
  return 1;
}

// ── Derived helpers ───────────────────────────────────────────────────────────

// Parse a YYYY-MM-DD string in LOCAL time (avoids UTC-rollback bug).
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Return "YYYY-MM-DD" n days after the given date string.
function addDaysToDateStr(str, n) {
  const d = parseLocalDate(str);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// state.destination is the source of truth for trip timezone/label; fall back
// gracefully for trips that haven't set one yet.
function tripTz() {
  return state.destination?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function tripLabel() {
  return state.destination?.label || 'destination';
}

// Convert an ISO datetime string to a fractional hour in trip time (e.g. 14.5 = 2:30 PM)
function toTripHour(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tripTz(), hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d);
  let h = parseInt(parts.find(p => p.type === 'hour')?.value  ?? '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  if (h === 24) h = 0;
  return h + m / 60;
}

// Return "YYYY-MM-DD" for an ISO datetime in trip time
function toTripDateStr(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleDateString('en-CA', { timeZone: tripTz() });
}

// Return trip day number (1-based) for an ISO datetime interpreted in trip time, or null
// if it falls outside the trip's date range.
function isoToTripDay(isoStr) {
  const diff = isoToTripDayUnclamped(isoStr);
  return diff != null && diff >= 1 && diff <= getDayCount() ? diff : null;
}

// Same as isoToTripDay but returns the day number even when it's outside the
// trip's range (e.g. a flight that departed the day before the trip starts).
function isoToTripDayUnclamped(isoStr) {
  const dateStr = toTripDateStr(isoStr);
  if (!dateStr || !state.startDate) return null;
  const start = parseLocalDate(state.startDate);
  const target = parseLocalDate(dateStr);
  return Math.round((target - start) / 86400000) + 1;
}

// Does this flight match the current view filter?
function flightMatchesView(flight) {
  if (viewFilter === 'all') return true;
  return (flight.people || []).includes(viewFilter);
}

// A departure flight leaves FROM the trip destination; an arrival flight lands there.
// Prefer the explicitly stored direction (set on save, user-correctable); fall back
// to the old tz-comparison heuristic for flights saved before direction existed.
function isTripDeparture(f) {
  if (f.direction) return f.direction === 'outbound';
  return f.departure?.tz === tripTz();
}

// Compute the visible (in-range) rendering segment for a flight, or null if none
// of it falls within the trip's date range. Inbound flights anchor on arrival
// (you're "not here yet" before landing); outbound flights anchor on departure
// (you're "gone" after leaving). Overnight legs get clamped to the visible day,
// with clampedStart/clampedEnd marking that the other end continues off-screen.
function flightRenderInfo(f) {
  if (!f.depIso || !f.arrIso) return null;
  const depHour = toTripHour(f.depIso);
  const arrHour = toTripHour(f.arrIso);
  const depDay  = isoToTripDayUnclamped(f.depIso);
  const arrDay  = isoToTripDayUnclamped(f.arrIso);
  if (depHour == null || arrHour == null || depDay == null || arrDay == null) return null;

  const n = getDayCount();

  if (isTripDeparture(f)) {
    if (depDay < 1 || depDay > n) return null;
    const clampedEnd = arrDay !== depDay;
    return {
      day: depDay,
      grayFrom: depHour, grayTo: 24,
      cardStart: depHour, cardEnd: clampedEnd ? 24 : arrHour,
      clampedStart: false, clampedEnd,
    };
  } else {
    if (arrDay < 1 || arrDay > n) return null;
    const clampedStart = depDay !== arrDay;
    return {
      day: arrDay,
      grayFrom: 0, grayTo: arrHour,
      cardStart: clampedStart ? 0 : depHour, cardEnd: arrHour,
      clampedStart, clampedEnd: false,
    };
  }
}

// Flight legs as virtual point-events for a given trip day, used by travel-time
// gap detection and home-distance indicators. Hour = the moment you're at that
// airport within the visible segment (arrival for inbound, departure for outbound).
function flightVirtualEventsForDay(day) {
  return (state.flights || [])
    .filter(f => flightMatchesView(f))
    .flatMap(f => {
      const info = flightRenderInfo(f);
      if (!info || info.day !== day) return [];
      if (isTripDeparture(f)) {
        if (f.departure?.lat == null) return [];
        return [{ id: `__flight_dep_${f.id}`, _isDep: true, hour: info.cardStart, duration: 0, location: { lat: f.departure.lat, lng: f.departure.lng } }];
      } else {
        if (f.arrival?.lat == null) return [];
        return [{ id: `__flight_${f.id}`, _isDep: false, hour: info.cardEnd, duration: 0, location: { lat: f.arrival.lat, lng: f.arrival.lng } }];
      }
    });
}

// Sorted list of point-in-time items (events + flight virtual events with coords)
// for a day — the shared input to travel-gap and home-distance calculations.
function dayTravelItems(day) {
  return [
    ...state.events.filter(e => e.day === day && e.hour != null && e.location?.lat != null),
    ...flightVirtualEventsForDay(day),
  ].sort((a, b) => a.hour - b.hour);
}

// Given a day's sorted travel items, decide which consecutive pairs are close
// enough (≤30 min gap) to need a between-event travel pill, and which items'
// unpaired ends need a home-distance pill. Shared by the desktop calendar's
// absolutely-positioned indicators and the mobile agenda's inline pills.
function computeTravelPairs(dayEvents, home) {
  const pairs = [];
  for (let i = 0; i < dayEvents.length - 1; i++) {
    const a = dayEvents[i], b = dayEvents[i + 1];
    const gap = b.hour - (a.hour + (a.duration ?? 1));
    if (gap <= 0.5) pairs.push({ a, b });
  }

  const homeBefore = []; // items needing a home → item pill
  const homeAfter  = []; // items needing an item → home pill
  if (home) {
    for (const evt of dayEvents) {
      const isFlightArrival   = evt.id.startsWith('__flight_') && !evt._isDep;
      const isFlightDeparture = evt._isDep === true;
      const hasPred = dayEvents.some(o =>
        o.id !== evt.id && (evt.hour - (o.hour + (o.duration ?? 1))) <= 0.5 && o.hour <= evt.hour
      );
      const hasSucc = dayEvents.some(o =>
        o.id !== evt.id && (o.hour - (evt.hour + (evt.duration ?? 1))) <= 0.5 && o.hour >= evt.hour
      );
      if (!hasPred && !isFlightArrival)   homeBefore.push(evt);
      if (!hasSucc && !isFlightDeparture) homeAfter.push(evt);
    }
  }
  return { pairs, homeBefore, homeAfter };
}

// ── View filter helpers ───────────────────────────────────────────────────────

// Should this event show in the current viewFilter?
// Events with no people are solid in "all" view, faded in person views.
function eventMatchesView(evt) {
  if (viewFilter === 'all') return true;
  const people = evt.people || [];
  if (people.length === 0) return false;
  return people.includes(viewFilter);
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
const agendaView   = document.getElementById('agenda-view');
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

// ── Layout / sizing ───────────────────────────────────────────────────────────

const calZoomEl = document.getElementById('cal-zoom');

function updateHourHeight() {
  const usable   = calContainer.clientHeight - getDayHeaderH();
  const isMobile = window.innerWidth <= 640;
  // On mobile, enforce a minimum that ensures the day is always taller than
  // the viewport (so vertical scroll always works). 44 px/hr × 24 hrs ≈ 1056 px.
  const minHH  = isMobile ? 44 : Math.max(20, usable / N_HOURS);
  // max: show ~10 hours at most before scrolling kicks in
  const maxHH  = isMobile ? 88 : Math.max(minHH, usable / 10);

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

  renderFilterBar();
  renderUnscheduled();

  const mobileAgenda = activeTab === 'calendar' && isMobile();
  calContainer.classList.toggle('hidden', mobileAgenda);
  agendaView.classList.toggle('hidden', !mobileAgenda);

  if (mobileAgenda) {
    const n = getDayCount();
    if (agendaDay == null || agendaDay < 1 || agendaDay > n) agendaDay = defaultAgendaDay();
    renderAgenda();
    renderAgendaTravelTimes();
  } else {
    renderTimeGutter();
    renderDays();
    updateHourHeight();
    updateColumnWidths();
  }

  if (activeTab === 'map') { renderMapDayStrip(); renderMap(); }

  // Async: fetch travel times and inject indicators after render settles
  if (activeTab === 'calendar' && !mobileAgenda) renderTravelTimes();
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

  // Place flight blocks for this day — only the segment that falls in range renders.
  (state.flights || []).forEach(f => {
    if (!flightMatchesView(f)) return;
    const info = flightRenderInfo(f);
    if (!info || info.day !== day) return;

    if (info.grayTo > info.grayFrom) {
      const grayout = document.createElement('div');
      grayout.className = 'flight-grayout';
      grayout.style.top    = `calc(var(--day-header-h) + ${info.grayFrom - START_HOUR} * var(--hour-height))`;
      grayout.style.height = `calc(${info.grayTo - info.grayFrom} * var(--hour-height))`;
      const lbl = document.createElement('div');
      lbl.className = 'flight-grayout-label';
      lbl.textContent = isTripDeparture(f) ? `Left ${tripLabel()}` : `Not in ${tripLabel()} yet`;
      grayout.appendChild(lbl);
      col.appendChild(grayout);
    }

    // Flight card — clamped to the visible portion of the leg on this day
    const dur = Math.max(0.5, info.cardEnd - info.cardStart);
    const fcard = document.createElement('div');
    fcard.className = 'event-card flight-card';
    fcard.dataset.flightId = f.id;
    fcard.style.top    = `calc(var(--day-header-h) + ${info.cardStart - START_HOUR} * var(--hour-height))`;
    fcard.style.height = `calc(${dur} * var(--hour-height) - 4px)`;

    // Overnight arrivals: the departure happened on a previous (possibly out-of-
    // range) day, so surface where/when it left from since the card alone can't show it.
    let titleText = `✈ ${f.number}`;
    if (info.clampedStart && f.departure?.iata) {
      const depDate = getDayDate(isoToTripDayUnclamped(f.depIso));
      const depDateStr = depDate ? depDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      titleText += ` · from ${f.departure.iata}${depDateStr ? ' ' + depDateStr : ''}`;
    }

    fcard.innerHTML = `
      <div class="event-card-title">${escHtml(titleText)}</div>
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
        init.className = 'person-initial';
        init.style.background = getPersonColor(p);
        init.textContent = getPersonName(p)[0].toUpperCase();
        init.title = getPersonName(p);
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
    // Double-tap isn't a natural gesture on touch — a single tap edits on mobile.
    if (isMobile()) chip.addEventListener('click', () => openModal(evt.id));
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
  if (evtId) {
    matchCardHorizPos(ind, col, evtId);
    const evtObj = [...(state.events || [])].find(e => e.id === evtId);
    if (evtObj && (evtObj.duration ?? 1) < 1) ind.dataset.compact = '1';
  }
  const bdg = document.createElement('span');
  bdg.className = `travel-badge travel-badge-home${warn ? ' travel-badge-warn' : ''}`;
  bdg.innerHTML = labelHtml;
  ind.appendChild(bdg);
  col.appendChild(ind);
}

// In-memory session cache — avoids redundant server round-trips within one page
// load. DB (Supabase via /api/route) is the sole persistent store; no localStorage.
const _routeMemCache = new Map();

// Abortable sleep — rejects with AbortError if signal fires during the wait.
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

// Counts DB-miss API calls in the current renderTravelTimes pass —
// used to stagger GraphHopper queries so we don't blow the rate limit.
let _routeCallCount = 0;
const ROUTE_STAGGER_MS = 125; // 40 misses × 125 ms ≈ 5 s

async function getDrivingInfo(from, to, signal) {
  const key = routeKey(from, to);

  // 1. In-memory hit (same page session, no network)
  if (_routeMemCache.has(key)) return _routeMemCache.get(key);

  // 2. Stagger before hitting the server so GraphHopper isn't flooded.
  //    (Server returns instantly for DB-cached routes; delay only matters for misses.)
  const delay = _routeCallCount++ * ROUTE_STAGGER_MS;
  if (delay > 0) {
    try { await sleep(delay, signal); } catch { return null; }
  }
  if (signal?.aborted) return null;

  // 3. Ask the server — it checks Supabase first, then GraphHopper on a miss,
  //    and writes the result back to Supabase before responding.
  try {
    const url = `${API_BASE}/api/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`;
    const res  = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    _routeMemCache.set(key, data);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    return null; // no fallback — show nothing rather than a wrong approximation
  }
}

let _travelAbort = null;

function routeKey(from, to) {
  return `${from.lat.toFixed(5)},${from.lng.toFixed(5)}->${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
}

// Render travel time indicators for back-to-back events on each day.
// "Back-to-back" = event B starts within 30 min of event A ending.
// Collect every route key needed across all days (grid + agenda both call this),
// then fetch all DB-cached ones in a single round-trip. Only true misses (not in
// DB) fall through to per-call GraphHopper lookups, staggered by getDrivingInfo.
async function prefetchAllRouteKeys(signal) {
  const n = getDayCount();
  const neededKeys = new Set();

  for (let day = 1; day <= n; day++) {
    const home = showHomeTravel ? getHomeForDay(day) : null;
    const dayEvents = dayTravelItems(day);
    const { pairs, homeBefore, homeAfter } = computeTravelPairs(dayEvents, home);

    for (const { a, b } of pairs) neededKeys.add(routeKey(a.location, b.location));
    for (const evt of homeBefore) neededKeys.add(routeKey(home, evt.location));
    for (const evt of homeAfter)  neededKeys.add(routeKey(evt.location, home));
  }

  const uncachedKeys = [...neededKeys].filter(k => !_routeMemCache.has(k));
  if (uncachedKeys.length === 0) return;

  try {
    const res = await fetch(`${API_BASE}/api/routes/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trip-Password': syncPassword, 'X-Trip-Id': tripId },
      body: JSON.stringify({ keys: uncachedKeys }),
      signal,
    });
    if (res.ok) {
      const { results } = await res.json();
      for (const [key, val] of Object.entries(results)) _routeMemCache.set(key, val);
      console.log(`[bulk] pre-warmed ${Object.keys(results).length}/${uncachedKeys.length} routes from DB`);
    }
  } catch (err) {
    // non-fatal (including AbortError) — individual getDrivingInfo calls still work
  }
}

async function renderTravelTimes() {
  if (_travelAbort) _travelAbort.abort();
  _travelAbort = new AbortController();
  const signal = _travelAbort.signal;
  _routeCallCount = 0; // reset stagger counter for this render pass

  const n = getDayCount();
  if (n === 0) return;

  await prefetchAllRouteKeys(signal);
  if (signal.aborted) return;

  for (let day = 1; day <= n; day++) {
    if (signal.aborted) return;
    const col = daysArea.querySelector(`.day-col[data-day="${day}"]`);
    if (!col) continue;

    // Inject flight virtual events for home-travel distance calculation.
    // Arrival flights  → virtual event at arrival airport (→ show airport→home pill).
    // Departure flights → virtual event at departure airport (→ show home→airport pill).
    const dayEvents = dayTravelItems(day);
    const home = showHomeTravel ? getHomeForDay(day) : null;
    const { pairs, homeBefore, homeAfter } = computeTravelPairs(dayEvents, home);

    for (const { a, b } of pairs) {
      if (signal.aborted) return;
      const aEndHour = a.hour + (a.duration ?? 1);

      const info = await getDrivingInfo(a.location, b.location, signal);
      if (!info) continue;

      const { driveMin, walkMin } = info;
      if (walkMin < 1) continue;

      const showWalk = walkMin <= 25;
      const isWarn   = walkMin > 10;
      const label    = showWalk
        ? `🚶 ${walkMin}m · 🚗 ${driveMin}m`
        : `🚗 ${driveMin}m`;

      const midOffset = aEndHour - START_HOUR;

      const existingKey = `travel-${a.id}-${b.id}`;
      col.querySelector(`[data-travel-key="${existingKey}"]`)?.remove();

      const indicator = document.createElement('div');
      indicator.className = 'travel-indicator';
      indicator.dataset.travelKey = existingKey;
      indicator.style.top = `calc(var(--day-header-h) + ${midOffset} * var(--hour-height) - 10px)`;
      if ((a.duration ?? 1) < 1 || (b.duration ?? 1) < 1) indicator.dataset.compact = '1';
      matchCardHorizPos(indicator, col, a.id);

      const badge = document.createElement('span');
      badge.className = `travel-badge${isWarn ? ' travel-badge-warn' : ''}`;
      badge.innerHTML = label;
      indicator.appendChild(badge);
      col.appendChild(indicator);
    }

    // ── Home distance indicators ──────────────────────────────────────────
    // homeBefore: events not back-to-back with a predecessor → show home → event.
    // homeAfter:  events not back-to-back with a successor   → show event → home.
    if (!home) continue;

    for (const evt of homeBefore) {
      if (signal.aborted) return;
      const info = await getDrivingInfo(home, evt.location, signal);
      if (info && !signal.aborted) {
        const { driveMin, walkMin } = info;
        if (walkMin >= 1) {
          const label = walkMin <= 25
            ? `🏠 → 🚶 ${walkMin}m · 🚗 ${driveMin}m`
            : `🏠 → 🚗 ${driveMin}m`;
          makeHomeTravelIndicator(col, `home-to-${evt.id}`, evt.hour - START_HOUR, label, walkMin > 10, evt.id);
        }
      }
    }

    for (const evt of homeAfter) {
      if (signal.aborted) return;
      const info = await getDrivingInfo(evt.location, home, signal);
      if (info && !signal.aborted) {
        const { driveMin, walkMin } = info;
        if (walkMin >= 1) {
          const label = walkMin <= 25
            ? `🚶 ${walkMin}m · 🚗 ${driveMin}m → 🏠`
            : `🚗 ${driveMin}m → 🏠`;
          // Use ?? 1 (not || 1) so duration=0 for flight arrivals places the
          // indicator right at arrival time, not 1 hour later.
          const endOffset = evt.hour + (evt.duration ?? 1) - START_HOUR;
          makeHomeTravelIndicator(col, `home-from-${evt.id}`, endOffset, label, walkMin > 10, evt.id);
        }
      }
    }
  }
}

// ── Mobile agenda view ───────────────────────────────────────────────────────
// Desktop keeps the calendar grid; phones get a day-at-a-time list instead —
// drag/resize don't work on touch, and a 24-hour grid doesn't fit a narrow screen.

function switchAgendaDay(d) {
  agendaDay = d;
  renderAgenda();
  renderAgendaTravelTimes();
}

// Swipe left/right anywhere in the agenda list to change days (no drag on mobile).
function attachAgendaSwipe(el) {
  let startX = null, startY = null;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (startX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
    const dy = (e.changedTouches[0]?.clientY ?? startY) - startY;
    startX = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // not a horizontal swipe
    const n = getDayCount();
    if (dx < 0 && agendaDay < n) switchAgendaDay(agendaDay + 1);
    else if (dx > 0 && agendaDay > 1) switchAgendaDay(agendaDay - 1);
  }, { passive: true });
}

function makeAgendaGrayRow(text) {
  const row = document.createElement('div');
  row.className = 'agenda-gray-row';
  row.textContent = text;
  return row;
}

function makeAgendaEmptyRow() {
  const row = document.createElement('div');
  row.className = 'agenda-empty-row';
  row.textContent = 'Nothing scheduled — tap ＋ to add something.';
  return row;
}

function makeAgendaEventRow(evt) {
  const el = document.createElement('div');
  el.className = 'agenda-row';
  el.dataset.travelId = evt.id;
  if (!eventMatchesView(evt)) el.classList.add('filtered-out');

  const time = document.createElement('div');
  time.className = 'agenda-row-time';
  time.textContent = `${formatHour(evt.hour)}–${formatHour(evt.hour + (evt.duration || 1))}`;
  el.appendChild(time);

  const body = document.createElement('div');
  body.className = 'agenda-row-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'agenda-row-title';
  const dot = document.createElement('span');
  dot.className = `chip-dot cat-dot-${evt.category}`;
  titleRow.appendChild(dot);
  const titleText = document.createElement('span');
  titleText.textContent = evt.title;
  titleRow.appendChild(titleText);
  body.appendChild(titleRow);

  const meta = document.createElement('div');
  meta.className = 'agenda-row-meta';
  if (evt.people && evt.people.length) {
    const ppl = document.createElement('div');
    ppl.className = 'event-people-initials';
    evt.people.forEach(p => {
      const init = document.createElement('div');
      init.className = 'person-initial';
      init.style.background = getPersonColor(p);
      init.textContent = getPersonName(p)[0].toUpperCase();
      init.title = getPersonName(p);
      ppl.appendChild(init);
    });
    meta.appendChild(ppl);
  }
  if (evt.hasReservation) {
    const res = document.createElement('span');
    res.className = 'event-has-res';
    res.textContent = 'RES';
    meta.appendChild(res);
  }
  if (evt.location?.lat != null) {
    const pin = document.createElement('span');
    pin.style.cssText = 'font-size:11px;opacity:0.6;';
    pin.textContent = '📍';
    meta.appendChild(pin);
  }
  if (evt.placeInfo?.hours?.periods?.length && evt.day != null && state.startDate) {
    const base = parseLocalDate(state.startDate);
    base.setDate(base.getDate() + evt.day - 1);
    const status = hoursStatusAt(evt.placeInfo.hours.periods, base.getDay(), evt.hour);
    if (!status.open) {
      const badge = document.createElement('span');
      badge.className = 'evt-closed-badge';
      badge.textContent = status.closedToday ? 'Closed today' : 'Closed';
      meta.appendChild(badge);
    }
  }
  if (meta.children.length) body.appendChild(meta);

  el.appendChild(body);
  el.addEventListener('click', () => openModal(evt.id));
  return el;
}

function makeAgendaFlightRow(f, info) {
  const el = document.createElement('div');
  el.className = 'agenda-row agenda-row-flight';
  el.dataset.travelId = isTripDeparture(f) ? `__flight_dep_${f.id}` : `__flight_${f.id}`;

  const time = document.createElement('div');
  time.className = 'agenda-row-time';
  time.textContent = `${formatHour(info.cardStart)}–${formatHour(info.cardEnd)}`;
  el.appendChild(time);

  const body = document.createElement('div');
  body.className = 'agenda-row-body';

  let titleText = `✈ ${f.number}`;
  if (info.clampedStart && f.departure?.iata) {
    const depDate = getDayDate(isoToTripDayUnclamped(f.depIso));
    const depDateStr = depDate ? depDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    titleText += ` · from ${f.departure.iata}${depDateStr ? ' ' + depDateStr : ''}`;
  }
  const titleRow = document.createElement('div');
  titleRow.className = 'agenda-row-title';
  titleRow.textContent = titleText;
  body.appendChild(titleRow);

  const meta = document.createElement('div');
  meta.className = 'agenda-row-meta';
  meta.textContent = `${f.departure.iata} → ${f.arrival.iata}`;
  body.appendChild(meta);

  el.appendChild(body);
  el.addEventListener('click', () => openFlightModal(f.id));
  return el;
}

function makeAgendaUntimedChip(evt) {
  const chip = document.createElement('div');
  chip.className = `event-chip${eventMatchesView(evt) ? '' : ' dimmed'}`;
  const dot = document.createElement('span');
  dot.className = `chip-dot cat-dot-${evt.category}`;
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode(evt.title));
  chip.addEventListener('click', () => openModal(evt.id));
  return chip;
}

function renderAgenda() {
  agendaView.innerHTML = '';
  const n = getDayCount();
  if (n === 0) {
    const empty = document.createElement('div');
    empty.className = 'agenda-empty-row';
    empty.textContent = 'Set a date range above to get started.';
    agendaView.appendChild(empty);
    return;
  }

  // ── Day switcher ──
  const switcher = document.createElement('div');
  switcher.className = 'agenda-day-switcher';
  for (let d = 1; d <= n; d++) {
    const lbl = getDayLabel(d);
    const btn = document.createElement('button');
    btn.className = `map-day-btn${agendaDay === d ? ' active' : ''}`;
    btn.textContent = `${lbl.dow} ${lbl.date}`;
    btn.addEventListener('click', () => switchAgendaDay(d));
    switcher.appendChild(btn);
  }
  agendaView.appendChild(switcher);

  const scroll = document.createElement('div');
  scroll.className = 'agenda-scroll';
  attachAgendaSwipe(scroll);
  agendaView.appendChild(scroll);

  const list = document.createElement('div');
  list.className = 'agenda-list';
  scroll.appendChild(list);

  const timedEvents = state.events.filter(e => e.day === agendaDay && e.hour != null);
  const flights = (state.flights || [])
    .filter(f => flightMatchesView(f))
    .map(f => ({ f, info: flightRenderInfo(f) }))
    .filter(x => x.info && x.info.day === agendaDay);

  // Leading grayout — inbound flights not yet landed cover 0..arrival
  flights
    .filter(x => !isTripDeparture(x.f))
    .forEach(() => list.appendChild(makeAgendaGrayRow(`Not in ${tripLabel()} yet`)));

  const rows = [
    ...timedEvents.map(evt => ({ type: 'event', evt, hour: evt.hour })),
    ...flights.map(({ f, info }) => ({ type: 'flight', f, info, hour: info.cardStart })),
  ].sort((a, b) => a.hour - b.hour);

  if (rows.length === 0 && flights.length === 0) list.appendChild(makeAgendaEmptyRow());

  rows.forEach(row => {
    list.appendChild(row.type === 'flight' ? makeAgendaFlightRow(row.f, row.info) : makeAgendaEventRow(row.evt));
  });

  // Trailing grayout — outbound flights already gone cover departure..end of day
  flights
    .filter(x => isTripDeparture(x.f))
    .forEach(() => list.appendChild(makeAgendaGrayRow(`Left ${tripLabel()}`)));

  // ── Untimed "sometime today" section ──
  const untimed = state.events.filter(e => e.day === agendaDay && e.hour == null);
  if (untimed.length) {
    const header = document.createElement('div');
    header.className = 'agenda-section-header';
    header.textContent = 'Sometime today';
    list.appendChild(header);
    const pool = document.createElement('div');
    pool.className = 'agenda-untimed-pool';
    untimed.forEach(evt => pool.appendChild(makeAgendaUntimedChip(evt)));
    list.appendChild(pool);
  }

  // ── Add-event FAB ──
  const fab = document.createElement('button');
  fab.className = 'agenda-fab';
  fab.textContent = '＋';
  fab.title = 'Add event';
  fab.addEventListener('click', () => openModal(null, { day: agendaDay }));
  agendaView.appendChild(fab);
}

let _agendaTravelAbort = null;

// Fetch driving-time labels for the day's travel pills and splice them into the
// already-rendered row list. Split from renderAgenda() so day switches paint
// immediately and pills fill in as they resolve, same as the desktop grid.
async function renderAgendaTravelTimes() {
  if (_agendaTravelAbort) _agendaTravelAbort.abort();
  _agendaTravelAbort = new AbortController();
  const signal = _agendaTravelAbort.signal;
  const day = agendaDay;

  await prefetchAllRouteKeys(signal);
  if (signal.aborted || day !== agendaDay) return;

  const list = agendaView.querySelector('.agenda-list');
  if (!list) return;

  const dayEvents = dayTravelItems(day);
  const home = showHomeTravel ? getHomeForDay(day) : null;
  const { pairs, homeBefore, homeAfter } = computeTravelPairs(dayEvents, home);

  const makePillEl = (info, extraClass, label) => {
    const isWarn = info.walkMin > 10;
    const row = document.createElement('div');
    row.className = `agenda-travel-pill${extraClass ? ' ' + extraClass : ''}`;
    const badge = document.createElement('span');
    badge.className = `travel-badge${extraClass ? ' travel-badge-home' : ''}${isWarn ? ' travel-badge-warn' : ''}`;
    badge.innerHTML = label;
    row.appendChild(badge);
    return row;
  };

  for (const { a, b } of pairs) {
    if (signal.aborted || day !== agendaDay) return;
    const info = await getDrivingInfo(a.location, b.location, signal);
    if (!info || info.walkMin < 1) continue;
    const rowA = list.querySelector(`[data-travel-id="${a.id}"]`);
    if (!rowA) continue;
    const label = info.walkMin <= 25 ? `🚶 ${info.walkMin}m · 🚗 ${info.driveMin}m` : `🚗 ${info.driveMin}m`;
    rowA.insertAdjacentElement('afterend', makePillEl(info, '', label));
  }

  for (const evt of homeBefore) {
    if (signal.aborted || day !== agendaDay) return;
    const info = await getDrivingInfo(home, evt.location, signal);
    if (!info || info.walkMin < 1) continue;
    const row = list.querySelector(`[data-travel-id="${evt.id}"]`);
    if (!row) continue;
    const label = info.walkMin <= 25 ? `🏠 → 🚶 ${info.walkMin}m · 🚗 ${info.driveMin}m` : `🏠 → 🚗 ${info.driveMin}m`;
    row.insertAdjacentElement('beforebegin', makePillEl(info, 'agenda-travel-pill-home', label));
  }

  for (const evt of homeAfter) {
    if (signal.aborted || day !== agendaDay) return;
    const info = await getDrivingInfo(evt.location, home, signal);
    if (!info || info.walkMin < 1) continue;
    const row = list.querySelector(`[data-travel-id="${evt.id}"]`);
    if (!row) continue;
    const label = info.walkMin <= 25 ? `🚶 ${info.walkMin}m · 🚗 ${info.driveMin}m → 🏠` : `🚗 ${info.driveMin}m → 🏠`;
    row.insertAdjacentElement('afterend', makePillEl(info, 'agenda-travel-pill-home', label));
  }
}

// ── Click empty cell ──────────────────────────────────────────────────────────

function onCellClick(e) {
  if (e.target !== e.currentTarget) return;
  openModal(null, { day: parseInt(e.currentTarget.dataset.day), hour: parseInt(e.currentTarget.dataset.hour) });
}

// ── View filter ───────────────────────────────────────────────────────────────

function renderFilterBar() {
  // Reset viewFilter if person was removed
  if (viewFilter !== 'all' && !(state.people || []).some(p => p.id === viewFilter)) {
    viewFilter = 'all';
  }
  const container = document.querySelector('.view-filters');
  container.innerHTML = '';

  const items = [{ id: 'all', name: 'All' }, ...(state.people || [])];
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = `filter-btn${viewFilter === item.id ? ' active' : ''}`;
    btn.dataset.view = item.id;
    btn.textContent = item.name;
    btn.addEventListener('click', () => {
      viewFilter = item.id;
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
    container.appendChild(btn);
  }
}

// ── People chips ──────────────────────────────────────────────────────────────

// Renders people chips into container; selectedClass is 'selected' (events) or 'active' (flights).
function renderPeopleChips(containerId, selectedIds = [], selectedClass = 'selected') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const people = state.people || [];
  if (!people.length) {
    const hint = document.createElement('span');
    hint.className = 'no-people-hint';
    hint.textContent = 'No people added — use 👥 to add.';
    container.appendChild(hint);
    return;
  }
  for (const p of people) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'person-chip';
    chip.dataset.person = p.id;
    chip.textContent = p.name;
    chip.style.setProperty('--chip-color', p.color || '#64748b');
    if (selectedIds.includes(p.id)) chip.classList.add(selectedClass);
    chip.addEventListener('click', () => chip.classList.toggle(selectedClass));
    container.appendChild(chip);
  }
}

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
    } else if (isMobile()) {
      calContainer.classList.add('hidden');
      agendaView.classList.remove('hidden');
      const n = getDayCount();
      if (agendaDay == null || agendaDay < 1 || agendaDay > n) agendaDay = defaultAgendaDay();
      renderAgenda();
      renderAgendaTravelTimes();
    } else {
      // Recalculate layout after returning to calendar
      calContainer.classList.remove('hidden');
      agendaView.classList.add('hidden');
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

// Center priority: destination coords → home coords → world view.
function defaultMapView() {
  if (state.destination?.lat != null) return { center: [state.destination.lat, state.destination.lng], zoom: 14 };
  if (state.home?.lat != null)        return { center: [state.home.lat, state.home.lng], zoom: 14 };
  return { center: [20, 0], zoom: 2 };
}

function initMap() {
  if (leafletMap) return;
  const { center, zoom } = defaultMapView();
  leafletMap = L.map('leaflet-map', {
    center, zoom,
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

  // Home marker — show per-day home if a day is filtered, else default
  const homeForMap = mapDayFilter != null ? getHomeForDay(mapDayFilter) : state.home;
  if (homeForMap?.lat != null) {
    const homeIcon = L.divIcon({
      html: '<div class="home-marker-icon">🏠</div>',
      className: '',
      iconSize:   [30, 30],
      iconAnchor: [15, 15],
      popupAnchor:[0, -18],
    });
    const hm = L.marker([homeForMap.lat, homeForMap.lng], { icon: homeIcon });
    hm.bindPopup(`
      <div class="map-popup-title">Home Base</div>
      <div class="map-popup-meta">${escHtml(homeForMap.address || '')}</div>
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
    const people  = (evt.people || []).map(p => getPersonName(p)).join(', ');

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

  // ── Flight airport markers ──────────────────────────────────────────────────
  (state.flights || []).forEach(f => {
    if (!flightMatchesView(f)) return;
    const fDay = flightRenderInfo(f)?.day ?? null;
    if (mapDayFilter !== null && fDay !== mapDayFilter) return;

    const departing = isTripDeparture(f);

    // Only show the trip-destination airport: departure airport for outbound, arrival for inbound.
    // This keeps origin airports off the map since the trip isn't there.
    const pts = [];
    if (departing && f.departure?.lat != null)
      pts.push({ airport: f.departure, label: `✈ Departs ${f.departure.iata}` });
    else if (!departing && f.arrival?.lat != null)
      pts.push({ airport: f.arrival, label: `✈ Arrives ${f.arrival.iata}` });

    pts.forEach(({ airport, label }) => {
      const icon = L.divIcon({
        html: `<div style="width:28px;height:28px;border-radius:50%;background:#475569;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:13px">✈</div>`,
        className: '',
        iconSize:   [28, 28],
        iconAnchor: [14, 14],
        popupAnchor:[0, -17],
      });
      const m = L.marker([airport.lat, airport.lng], { icon });
      const dayLbl = fDay != null ? getDayLabel(fDay) : null;
      const dayStr = dayLbl ? `Day ${dayLbl.num} · ${dayLbl.dow} ${dayLbl.date}` : '';
      const people = (f.people || []).map(p => getPersonName(p)).join(', ');
      m.bindPopup(`
        <div class="map-popup-title">${label}</div>
        <div class="map-popup-meta">
          ${f.number}${dayStr ? ' · ' + dayStr : ''}
          ${people ? '<br>' + people : ''}
        </div>
      `);
      m.addTo(leafletMap);
      mapMarkers.push(m);
    });
  });

  const hasAnyMarker = mapMarkers.length > 0;
  mapNoCoordsEl.classList.toggle('hidden', hasAnyMarker);

  if (hasAnyMarker) {
    const group = L.featureGroup(mapMarkers);
    leafletMap.fitBounds(group.getBounds().pad(0.3));
  } else {
    // No home, no events: fall back to destination → home → world view
    const { center, zoom } = defaultMapView();
    leafletMap.setView(center, zoom);
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
// Short links (maps.app.goo.gl) are expanded server-side to avoid CORS issues.
async function resolveGoogleMapsCoords(url) {
  if (!url) return null;

  // Non-short URL: parse coordinates directly from the URL string
  if (!/goo\.gl|maps\.app\.goo\.gl/i.test(url)) {
    return parseGoogleMapsUrl(url);
  }

  // Short URL — ask the server to expand it
  try {
    console.log(`[resolveCoords] expanding short URL via server: ${url}`);
    const res  = await fetch(`${API_BASE}/api/resolve-url?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) { console.warn('[resolveCoords] server error:', data); return null; }
    console.log(`[resolveCoords] resolved:`, data);
    return { lat: data.lat, lng: data.lng };
  } catch (err) {
    console.error('[resolveCoords] fetch failed:', err);
    return null;
  }
}

// Geocode a free-text address via the server (Google Geocoding API).
async function geocodeAddress(text) {
  console.log(`[geocode] "${text}"`);
  try {
    const res  = await fetch(`${API_BASE}/api/geocode?address=${encodeURIComponent(text)}`);
    console.log(`[geocode] status: ${res.status}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`[geocode] server error:`, err);
      return null;
    }
    const data = await res.json();
    console.log(`[geocode] result:`, data);
    return { lat: data.lat, lng: data.lng, address: data.formattedAddress };
  } catch (err) {
    console.error(`[geocode] fetch failed:`, err);
    return null;
  }
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
      console.log(`[resolvePlace] geocoding address: "${val}"`);
      const result = await geocodeAddress(val);
      if (result) {
        console.log(`[resolvePlace] geocode success:`, result);
        currentLocationData = { ...result, address: val };
        locStatus.className   = 'location-status ok';
        locStatus.textContent = `Found: ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
      } else {
        console.warn(`[resolvePlace] geocode returned null for "${val}"`);
        locStatus.className   = 'location-status err';
        locStatus.textContent = 'Location not found. Try a more specific address.';
      }
      currentPlaceInfo = null;
      placeInfoEl.classList.add('hidden');
    }
  } catch (err) {
    console.error(`[resolvePlace] unexpected error:`, err);
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
    renderPeopleChips('people-chips', evt.people || []);
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
    renderPeopleChips('people-chips', []);
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

  const people  = [...document.querySelectorAll('#people-chips .person-chip.selected')].map(c => c.dataset.person);
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

// Switch between the desktop grid and the mobile agenda when crossing the breakpoint
// (e.g. rotating a tablet, or resizing a desktop window past 640px).
mobileMQ.addEventListener('change', () => {
  if (activeTab === 'calendar') render();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Home base ────────────────────────────────────────────────────────────────

let pendingHomeLocation = null;
let homeSelectedDay     = null; // null = default (state.home), number = per-day override

function updateHomeButton() {
  const hasDefault = state.home?.lat != null;
  const hasAnyDay  = Object.values(state.homeDays || {}).some(h => h?.lat != null);
  btnHome.classList.toggle('is-set', hasDefault || hasAnyDay);
  homeLabel.textContent = hasDefault
    ? (state.home.address?.split(',')[0] || 'Home set')
    : hasAnyDay ? 'Home (per day)' : 'Set home';
}

function openHomeModal(day = null) {
  homeSelectedDay = day;
  const daySelect = document.getElementById('home-day-select');

  // Populate day options
  daySelect.innerHTML = '<option value="">All days (default)</option>';
  const n = getDayCount();
  for (let d = 1; d <= n; d++) {
    const lbl = getDayLabel(d);
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `Day ${lbl.num} · ${lbl.dow} ${lbl.date}`;
    daySelect.appendChild(opt);
  }
  daySelect.value = day != null ? String(day) : '';

  function loadForSelectedDay() {
    const d = daySelect.value ? parseInt(daySelect.value) : null;
    homeSelectedDay = d;
    const home = d != null ? (state.homeDays?.[String(d)] || null) : (state.home || null);
    pendingHomeLocation = home ? { ...home } : null;
    homeAddressEl.value = home?.address || '';
    homeLocStatus.textContent = '';
    homeLocStatus.className = 'location-status';
    if (home?.lat != null) {
      homeLocStatus.className   = 'location-status ok';
      homeLocStatus.textContent = `Saved: ${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`;
    }
    homeModalClear.classList.toggle('hidden', !home);
  }

  loadForSelectedDay();
  daySelect.onchange = loadForSelectedDay;
  homeModalOverlay.classList.remove('hidden');
  setTimeout(() => homeAddressEl.focus(), 50);
}

btnHome.addEventListener('click', () => openHomeModal(null));

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
    console.log(`[homeLocate] input: "${val}"`);
    if (isGoogleMapsUrl(val)) {
      homeLocStatus.textContent = 'Looking up place…';
      const res  = await fetch(`${API_BASE}/api/place?url=${encodeURIComponent(val)}`);
      const data = await res.json();
      if (res.ok && data.lat != null) {
        pendingHomeLocation       = { lat: data.lat, lng: data.lng, address: data.address || val };
        homeLocStatus.className   = 'location-status ok';
        homeLocStatus.textContent = data.name || `Found: ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;
      } else {
        homeLocStatus.className   = 'location-status err';
        homeLocStatus.textContent = data.error || 'Place not found. Try the full Google Maps URL.';
      }
      return;
    }
    homeLocStatus.textContent = 'Geocoding address…';
    console.log(`[homeLocate] geocoding address: "${val}"`);
    const result = await geocodeAddress(val);
    if (result) {
      console.log(`[homeLocate] geocode success:`, result);
      pendingHomeLocation       = { ...result, address: homeAddressEl.value.trim() };
      homeLocStatus.className   = 'location-status ok';
      homeLocStatus.textContent = `Found: ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
    } else {
      console.warn(`[homeLocate] geocode returned null for "${val}"`);
      pendingHomeLocation       = null;
      homeLocStatus.className   = 'location-status err';
      homeLocStatus.textContent = 'Location not found. Try a more specific address.';
    }
  } catch (err) {
    console.error(`[homeLocate] unexpected error:`, err);
    homeLocStatus.className   = 'location-status err';
    homeLocStatus.textContent = 'Geocoding failed. Check your connection.';
  } finally {
    btnHomeLocate.classList.remove('loading');
  }
});

homeModalSave.addEventListener('click', () => {
  const addressText = homeAddressEl.value.trim();
  let val = null;
  if (pendingHomeLocation) {
    val = { ...pendingHomeLocation, address: addressText || pendingHomeLocation.address };
  } else if (addressText) {
    val = { address: addressText, lat: null, lng: null };
  }
  if (homeSelectedDay != null) {
    if (!state.homeDays) state.homeDays = {};
    state.homeDays[String(homeSelectedDay)] = val;
  } else {
    state.home = val;
  }
  save();
  updateHomeButton();
  homeModalOverlay.classList.add('hidden');
  if (activeTab === 'map') renderMap();
  if (activeTab === 'calendar') renderTravelTimes();
});

homeModalClear.addEventListener('click', () => {
  if (homeSelectedDay != null) {
    if (state.homeDays) delete state.homeDays[String(homeSelectedDay)];
  } else {
    state.home = null;
  }
  save();
  updateHomeButton();
  homeModalOverlay.classList.add('hidden');
  if (activeTab === 'map') renderMap();
  if (activeTab === 'calendar') renderTravelTimes();
});

homeModalCancel.addEventListener('click', () => homeModalOverlay.classList.add('hidden'));
homeModalOverlay.addEventListener('click', e => { if (e.target === homeModalOverlay) homeModalOverlay.classList.add('hidden'); });
homeModalOverlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') homeModalOverlay.classList.add('hidden');
  if (e.key === 'Enter')  homeModalSave.click();
});

// ── Destination ───────────────────────────────────────────────────────────────

const btnDestination   = document.getElementById('btn-destination');
const destinationLabel = document.getElementById('destination-label');
const destModalOverlay = document.getElementById('destination-modal-overlay');
const destLabelEl      = document.getElementById('dest-label');
const destTzEl         = document.getElementById('dest-tz');
const destAddressEl    = document.getElementById('dest-address');
const btnDestLocate    = document.getElementById('btn-dest-locate');
const destLocStatus    = document.getElementById('dest-location-status');
const destModalClear   = document.getElementById('destination-modal-clear');
const destModalCancel  = document.getElementById('destination-modal-cancel');
const destModalSave    = document.getElementById('destination-modal-save');

let pendingDestLocation = null;

function updateDestinationButton() {
  const d = state.destination;
  btnDestination.classList.toggle('is-set', !!d);
  destinationLabel.textContent = d?.label || 'Set destination';
}

function populateTimezoneOptions() {
  if (destTzEl.options.length) return; // populate once
  const tzs = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [Intl.DateTimeFormat().resolvedOptions().timeZone];
  for (const tz of tzs) destTzEl.appendChild(new Option(tz, tz));
}

function openDestinationModal() {
  populateTimezoneOptions();
  const d = state.destination;
  destLabelEl.value   = d?.label || '';
  destTzEl.value       = d?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  destAddressEl.value  = d?.address || '';
  pendingDestLocation  = d?.lat != null ? { lat: d.lat, lng: d.lng, address: d.address } : null;
  destLocStatus.className   = d?.lat != null ? 'location-status ok' : 'location-status';
  destLocStatus.textContent = d?.lat != null ? `Saved: ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : '';
  destModalClear.classList.toggle('hidden', !d);
  destModalOverlay.classList.remove('hidden');
  setTimeout(() => destLabelEl.focus(), 50);
}

btnDestination.addEventListener('click', openDestinationModal);

btnDestLocate.addEventListener('click', async () => {
  const val = destAddressEl.value.trim();
  if (!val) {
    destLocStatus.className   = 'location-status err';
    destLocStatus.textContent = 'Enter an address or city.';
    return;
  }
  btnDestLocate.classList.add('loading');
  destLocStatus.className   = 'location-status info';
  destLocStatus.textContent = 'Geocoding…';
  const result = await geocodeAddress(val);
  if (result) {
    pendingDestLocation       = { ...result };
    destLocStatus.className   = 'location-status ok';
    destLocStatus.textContent = `Found: ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
  } else {
    pendingDestLocation       = null;
    destLocStatus.className   = 'location-status err';
    destLocStatus.textContent = 'Location not found. Try a more specific address.';
  }
  btnDestLocate.classList.remove('loading');
});

destModalSave.addEventListener('click', () => {
  const label = destLabelEl.value.trim() || 'destination';
  state.destination = {
    label, tz: destTzEl.value,
    lat: pendingDestLocation?.lat ?? state.destination?.lat ?? null,
    lng: pendingDestLocation?.lng ?? state.destination?.lng ?? null,
    address: pendingDestLocation?.address ?? destAddressEl.value.trim() ?? null,
  };
  save();
  updateDestinationButton();
  destModalOverlay.classList.add('hidden');
  if (activeTab === 'map') renderMap();
  render();
});

destModalClear.addEventListener('click', () => {
  state.destination = null;
  save();
  updateDestinationButton();
  destModalOverlay.classList.add('hidden');
  if (activeTab === 'map') renderMap();
  render();
});

destModalCancel.addEventListener('click', () => destModalOverlay.classList.add('hidden'));
destModalOverlay.addEventListener('click', e => { if (e.target === destModalOverlay) destModalOverlay.classList.add('hidden'); });
destModalOverlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') destModalOverlay.classList.add('hidden');
  if (e.key === 'Enter')  destModalSave.click();
});

// ── People manager ────────────────────────────────────────────────────────────

const peopleModalOverlay = document.getElementById('people-modal-overlay');
const peopleManagerContent = document.getElementById('people-manager-content');

function renderPeopleManager() {
  peopleManagerContent.innerHTML = '';
  const people = state.people || [];

  // Existing people as removable tags
  const members = document.createElement('div');
  members.className = 'pm-members';
  if (!people.length) {
    const hint = document.createElement('span');
    hint.className = 'no-people-hint';
    hint.textContent = 'No people yet.';
    members.appendChild(hint);
  }
  for (const person of people) {
    const tag = document.createElement('span');
    tag.className = 'pm-person-tag';
    tag.style.setProperty('--chip-color', person.color || '#64748b');
    const nameEl = document.createElement('span');
    nameEl.textContent = person.name;
    tag.appendChild(nameEl);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'pm-person-remove';
    removeBtn.textContent = '×';
    removeBtn.title = `Remove ${person.name}`;
    removeBtn.addEventListener('click', () => {
      state.people = state.people.filter(p => p.id !== person.id);
      save(); renderPeopleManager();
    });
    tag.appendChild(removeBtn);
    members.appendChild(tag);
  }
  peopleManagerContent.appendChild(members);

  // Add person row
  const addRow = document.createElement('div');
  addRow.className = 'pm-add-person-row';
  addRow.style.marginTop = '12px';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = 'Add person…';
  addInput.className = 'pm-add-input';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-ghost pm-btn-sm';
  addBtn.textContent = 'Add';
  const doAdd = () => {
    const name = addInput.value.trim();
    if (!name) return;
    const base = slugify(name);
    let id = base, n = 1;
    while (state.people.some(p => p.id === id)) id = `${base}_${n++}`;
    state.people.push({ id, name, color: nextPersonColor() });
    addInput.value = '';
    save(); renderPeopleManager();
  };
  addBtn.addEventListener('click', doAdd);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  peopleManagerContent.appendChild(addRow);
}

document.getElementById('btn-manage-people').addEventListener('click', () => {
  renderPeopleManager();
  peopleModalOverlay.classList.remove('hidden');
});

document.getElementById('people-modal-done').addEventListener('click', () => {
  peopleModalOverlay.classList.add('hidden');
  render();
});

peopleModalOverlay.addEventListener('click', e => {
  if (e.target === peopleModalOverlay) {
    peopleModalOverlay.classList.add('hidden');
    render();
  }
});

// ── Flights ───────────────────────────────────────────────────────────────────

const flightModalOverlay = document.getElementById('flight-modal-overlay');
const flightModalTitle   = document.getElementById('flight-modal-title');
const fltExistingList    = document.getElementById('flt-existing-list');
const fltNumber          = document.getElementById('flt-number');
const fltDate            = document.getElementById('flt-date');
const fltLookup          = document.getElementById('flt-lookup');
const fltStatus          = document.getElementById('flt-status');
const fltResults         = document.getElementById('flt-results');
const fltDelete          = document.getElementById('flt-delete');
const fltCancel          = document.getElementById('flt-cancel');
const fltSave            = document.getElementById('flt-save');

let fltSelectedResult = null;  // the flight object chosen from lookup results
let fltEditingId      = null;  // id of flight being edited (null = new)

// Flights that render nowhere on the calendar (fully outside the trip range)
// are otherwise unreachable — cards are the only edit entry point. Surface a
// compact list at the top of the Add Flight modal so they stay editable.
function renderExistingFlightsList() {
  const flights = state.flights || [];
  fltExistingList.innerHTML = '';
  if (!flights.length) { fltExistingList.classList.add('hidden'); return; }
  fltExistingList.classList.remove('hidden');

  const heading = document.createElement('div');
  heading.className = 'flt-existing-heading';
  heading.textContent = 'Existing flights — tap to edit';
  fltExistingList.appendChild(heading);

  [...flights].sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(f => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'flt-existing-row';
    const peopleStr = (f.people || []).map(p => getPersonName(p)).join(', ');
    row.innerHTML = `
      <span class="flt-existing-num">${escHtml(f.number || '?')}</span>
      <span class="flt-existing-route">${escHtml(f.departure?.iata || '?')} → ${escHtml(f.arrival?.iata || '?')}</span>
      <span class="flt-existing-date">${escHtml(f.date || '')}</span>
      ${peopleStr ? `<span class="flt-existing-people">${escHtml(peopleStr)}</span>` : ''}
    `;
    row.addEventListener('click', () => openFlightModal(f.id));
    fltExistingList.appendChild(row);
  });
}

function openFlightModal(id = null) {
  fltEditingId      = id;
  fltSelectedResult = null;
  fltResults.innerHTML = '';
  fltResults.classList.add('hidden');
  fltStatus.textContent = '';
  fltSave.classList.add('hidden');
  fltDelete.classList.toggle('hidden', !id);
  flightModalTitle.textContent = id ? 'Edit Flight' : 'Add Flight';
  fltExistingList.classList.toggle('hidden', !!id);
  if (!id) renderExistingFlightsList();

  if (id) {
    const f = (state.flights || []).find(x => x.id === id);
    if (f) {
      fltNumber.value = f.number;
      fltDate.value   = f.date;
      renderPeopleChips('flt-people-chips', f.people || [], 'active');
      fltSelectedResult = f;
      fltDepTzEl.textContent = f.departure?.tz ? `(${f.departure.tz.split('/').pop().replace('_', ' ')})` : '(local)';
      fltArrTzEl.textContent = f.arrival?.tz ? `(${f.arrival.tz.split('/').pop().replace('_', ' ')})` : '(arrival airport local time)';
      fltDepTime.value  = f.depIso ? isoToTimeInput(f.depIso, f.departure?.tz) : '';
      fltArrTime.value  = f.arrIso ? isoToTimeInput(f.arrIso, f.arrival?.tz)   : '';
      const departing = isTripDeparture(f);
      fltDirInbound.checked  = !departing;
      fltDirOutbound.checked = departing;
      fltTimesEl.classList.remove('hidden');
      fltSave.classList.remove('hidden');
      fltSave.textContent = 'Save Changes';
    }
  } else {
    fltNumber.value = '';
    fltDate.value   = state.startDate || '';
    fltSave.textContent = 'Add Flight';
    renderPeopleChips('flt-people-chips', [], 'active');
    fltDepTime.value = '';
    fltArrTime.value = '';
    fltTimesEl.classList.add('hidden');
  }

  flightModalOverlay.classList.remove('hidden');
  fltNumber.focus();
}


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

const fltTimesEl     = document.getElementById('flt-times');
const fltDepTime     = document.getElementById('flt-dep-time');
const fltArrTime     = document.getElementById('flt-arr-time');
const fltDepTzEl     = document.querySelector('.flt-dep-tz');
const fltArrTzEl     = document.getElementById('flt-arr-tz');
const fltDirInbound  = document.getElementById('flt-dir-inbound');
const fltDirOutbound = document.getElementById('flt-dir-outbound');

function selectFlightResult(f) {
  fltSelectedResult = f;
  fltStatus.className   = 'location-status ok';
  fltStatus.textContent = `${f.departure.iata} → ${f.arrival.iata} · ${f.airline}`;

  // Show time inputs — pre-fill from API if times are available, else leave blank.
  // Both inputs edit round-trip through their own airport's local time.
  fltDepTzEl.textContent = f.departure.tz ? `(${f.departure.tz.split('/').pop().replace('_', ' ')})` : '(local)';
  fltArrTzEl.textContent = f.arrival.tz   ? `(${f.arrival.tz.split('/').pop().replace('_', ' ')})`   : '(arrival airport local time)';
  fltDepTime.value = f.departure.time ? isoToTimeInput(f.departure.time, f.departure.tz) : '';
  fltArrTime.value = f.arrival.time   ? isoToTimeInput(f.arrival.time,   f.arrival.tz)   : '';
  fltTimesEl.classList.remove('hidden');
  fltSave.classList.remove('hidden');

  // Guess direction from arrival tz — arriving at the trip destination's tz means inbound.
  // If no destination is set yet, default to inbound (the common "first flight" case).
  const guessInbound = state.destination == null || f.arrival?.tz === tripTz();
  fltDirInbound.checked  = guessInbound;
  fltDirOutbound.checked = !guessInbound;
}

// Convert an ISO datetime to "HH:MM" for <input type="time"> in the given timezone
function isoToTimeInput(isoStr, tz) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || tripTz(), hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const h = parts.find(p => p.type === 'hour')?.value   ?? '00';
    const m = parts.find(p => p.type === 'minute')?.value ?? '00';
    return `${h === '24' ? '00' : h}:${m}`;
  } catch { return ''; }
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
    const pm = parseInt(probeLocal.find(p=>p.type==='minute').value);
    const offsetMin  = (ph * 60 + pm) - 12 * 60; // total offset in minutes (handles half-hour zones like India)
    const sign       = offsetMin >= 0 ? '+' : '-';
    const absMin     = Math.abs(offsetMin);
    const isoOffset  = `${sign}${String(Math.floor(absMin / 60)).padStart(2,'0')}:${String(absMin % 60).padStart(2,'0')}`;
    return `${dateStr}T${timeStr}:00${isoOffset}`;
  } catch { return null; }
}

// Format an ISO datetime for display in trip time
function formatIsoForDisplay(isoStr, tripTimeOnly = false) {
  if (!isoStr) return '?';
  try {
    const d = new Date(isoStr);
    // Show time in trip destination's timezone
    const tripTime = d.toLocaleTimeString('en-US', { timeZone: tripTz(), hour: 'numeric', minute: '2-digit', hour12: true });
    if (tripTimeOnly) return `${tripTime} ${tripLabel()}`;
    // For departure show local departure time
    const local = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return local;
  } catch { return isoStr; }
}

fltSave.addEventListener('click', () => {
  if (!fltSelectedResult) return;

  if (!fltDepTime.value || !fltArrTime.value) {
    fltStatus.className   = 'location-status err';
    fltStatus.textContent = 'Enter departure and arrival times above.';
    return;
  }

  const depDate = fltDate.value;
  const depIso  = buildIsoInTz(depDate, fltDepTime.value, fltSelectedResult.departure.tz);

  // Arrival date can differ from departure (overnight flights). Prefer the
  // lookup API's arrival date if we have one; otherwise assume same-day and
  // roll forward if that would put arrival before departure.
  let arrDate = fltSelectedResult.arrival?.time ? fltSelectedResult.arrival.time.slice(0, 10) : depDate;
  const tentativeArrIso = buildIsoInTz(arrDate, fltArrTime.value, fltSelectedResult.arrival.tz);
  if (depIso && tentativeArrIso && new Date(tentativeArrIso) < new Date(depIso)) {
    arrDate = addDaysToDateStr(arrDate, 1);
  }
  const arrIso = buildIsoInTz(arrDate, fltArrTime.value, fltSelectedResult.arrival.tz);

  if (!depIso || !arrIso) {
    fltStatus.className   = 'location-status err';
    fltStatus.textContent = 'Could not resolve flight times — missing timezone data.';
    return;
  }

  const direction = fltDirOutbound.checked ? 'outbound' : 'inbound';

  const people = [...document.querySelectorAll('#flt-people-chips .person-chip.active')].map(c => c.dataset.person);
  if (!state.flights) state.flights = [];

  const entry = {
    id:   fltEditingId || uid(),
    date: fltDate.value,
    ...fltSelectedResult,
    people,          // after spread so chip selection always wins
    direction,
    depIso,
    arrIso,
  };

  if (fltEditingId) {
    const idx = state.flights.findIndex(f => f.id === fltEditingId);
    if (idx !== -1) state.flights[idx] = entry;
  } else {
    state.flights.push(entry);
  }

  // Auto-suggest a destination from the first inbound flight, if none is set yet.
  if (state.destination == null && direction === 'inbound' && entry.arrival?.tz) {
    state.destination = {
      label: entry.arrival.name || entry.arrival.iata || 'destination',
      tz:    entry.arrival.tz,
      lat:   entry.arrival.lat ?? null,
      lng:   entry.arrival.lng ?? null,
    };
    updateDestinationButton();
    setSyncStatus(`Destination set to ${state.destination.label} — tap 🌍 to change`, 'saved');
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
  localStorage.removeItem(pwKey());
  localStorage.removeItem(pwTsKey());
  syncPassword = '';
  clearInterval(syncPollTimer);
  showPasswordGate();
});

// Clean up legacy localStorage route cache if present
localStorage.removeItem('trip-osrm-cache');

// ── Landing page ──────────────────────────────────────────────────────────────

async function showLandingPage() {
  document.getElementById('landing-view').classList.remove('hidden');
  document.getElementById('main-header').classList.add('hidden');
  document.getElementById('filter-bar').classList.add('hidden');
  document.getElementById('calendar-view').classList.add('hidden');
  document.getElementById('map-view').classList.add('hidden');
  document.getElementById('password-overlay').classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/api/trips`);
    const { trips } = await res.json();
    const list = document.getElementById('trips-list');
    list.innerHTML = '';
    if (!trips.length) {
      list.innerHTML = '<p class="no-trips">No trips yet — create one below.</p>';
    } else {
      for (const trip of trips) {
        const a = document.createElement('a');
        a.className = 'trip-card';
        a.href = `?trip=${trip.id}`;
        a.textContent = trip.name;
        list.appendChild(a);
      }
    }
  } catch {
    document.getElementById('trips-list').innerHTML = '<p class="no-trips">Could not load trips.</p>';
  }

  document.getElementById('btn-create-trip').addEventListener('click', async () => {
    const nameEl  = document.getElementById('new-trip-name');
    const pwEl    = document.getElementById('new-trip-password');
    const errEl   = document.getElementById('new-trip-error');
    const btn     = document.getElementById('btn-create-trip');
    const name    = nameEl.value.trim();
    const password = pwEl.value.trim();
    errEl.classList.add('hidden');
    if (!name || !password) {
      errEl.textContent = 'Name and password are required.';
      errEl.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        errEl.textContent = error || 'Failed to create trip.';
        errEl.classList.remove('hidden');
        return;
      }
      const { id } = await res.json();
      // Pre-store password so the trip loads immediately without a gate
      localStorage.setItem(`trip-password-${id}`, password);
      localStorage.setItem(`trip-password-ts-${id}`, Date.now().toString());
      window.location.href = `?trip=${id}`;
    } catch {
      errEl.textContent = 'Could not reach the server.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

// Bootstrap: render nothing until auth confirmed
(async () => {
  if (!tripId) {
    showLandingPage();
    return;
  }

  if (syncPassword) {
    const ok = await syncLoad();
    if (ok) {
      hidePasswordGate();
      updateHomeButton();
      updateDestinationButton();
      render();
      scrollToHour(17);
      startSyncPoll();
    }
    // if not ok, syncLoad already called showPasswordGate()
  } else {
    showPasswordGate();
  }
})();
