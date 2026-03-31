// ── Constants ─────────────────────────────────────────────────────────────────

// Backend API — local dev vs deployed. Update PROD_API_BASE when you deploy the server.
const IS_LOCAL    = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE    = IS_LOCAL ? 'http://localhost:3001' : 'https://YOUR_DEPLOYED_BACKEND_URL';

const STORAGE_KEY = 'trip-planner-v2';
const START_HOUR  = 7;
const END_HOUR    = 23;
const N_HOURS     = END_HOUR - START_HOUR + 1; // 17
const HOURS       = Array.from({ length: N_HOURS }, (_, i) => i + START_HOUR);
const FIXED_COL_W = 180; // px for >7 days

const PEOPLE_LABEL = { jay: 'Jay', abi: 'Abi', austin: 'Austin', johanna: 'Johanna' };
const COUPLE_MAP   = { jay: 'jay-abi', abi: 'jay-abi', austin: 'austin-johanna', johanna: 'austin-johanna' };
const CAT_COLOR    = { food: '#f97316', activity: '#22c55e', accommodation: '#3b82f6', transport: '#a855f7', other: '#64748b' };
const CAT_LABEL    = { food: 'Food & Drink', activity: 'Activity', accommodation: 'Stay', transport: 'Transport', other: 'Other' };

// ── State ─────────────────────────────────────────────────────────────────────

function defaultState() {
  return { tripName: 'My Trip', startDate: '', endDate: '', events: [], home: null };
}

let state = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState(); }
  catch { return defaultState(); }
})();

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function uid()  { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

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
  if (h === 0)  return '12 AM';
  if (h === 12) return '12 PM';
  if (h > 24)   return formatHour(h - 24);
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function getHourHeight() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-height')) || 64;
}

function getDayHeaderH() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--day-header-h')) || 52;
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
const mapLegend    = document.getElementById('map-legend');
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
const peopleChips  = document.querySelectorAll('.person-chip');

// ── Layout / sizing ───────────────────────────────────────────────────────────

function updateHourHeight() {
  const n = getDayCount();
  let hh;
  if (n > 0 && n <= 7) {
    const available = calContainer.clientHeight;
    hh = Math.max(36, (available - getDayHeaderH()) / N_HOURS);
    calScroll.style.overflowY = 'hidden';
  } else {
    hh = 64;
    calScroll.style.overflowY = 'auto';
  }
  document.documentElement.style.setProperty('--hour-height', hh + 'px');
}

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
    cell.addEventListener('click',     onCellClick);
    cell.addEventListener('dragover',  onDragOver);
    cell.addEventListener('dragleave', onDragLeave);
    cell.addEventListener('drop',      onDrop);
    col.appendChild(cell);
  });

  // Place events
  state.events.filter(e => e.day === day).forEach(evt => {
    const card = makeEventCard(evt);
    positionCard(card, evt);
    col.appendChild(card);
  });

  return col;
}

function positionCard(card, evt) {
  if (evt.hour == null) return;
  // CSS calc with var(--hour-height) so cards auto-reposition when the
  // variable changes (e.g. on resize or unscheduled-bar toggle) without
  // needing a full re-render.
  const offset = evt.hour - START_HOUR;
  const dur    = evt.duration || 1;
  card.style.top    = `calc(var(--day-header-h) + ${offset} * var(--hour-height))`;
  card.style.height = `calc(${dur} * var(--hour-height) - 4px)`;
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

  const editBtn = document.createElement('button');
  editBtn.className   = 'event-edit-btn';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', e => { e.stopPropagation(); openModal(evt.id); });

  const titleEl = document.createElement('div');
  titleEl.className   = 'event-card-title';
  titleEl.textContent = evt.title;

  const meta = document.createElement('div');
  meta.className = 'event-card-meta';

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
      badge.textContent = 'Closed';
      meta.appendChild(badge);
    }
  }

  card.append(editBtn, titleEl, meta);
  card.addEventListener('dragstart', onDragStart);
  card.addEventListener('dragend',   onDragEnd);
  return card;
}

function renderUnscheduled() {
  pool.innerHTML = '';
  const unscheduled = state.events.filter(e => e.day == null);
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

    chip.addEventListener('dragstart', onDragStart);
    chip.addEventListener('dragend',   onDragEnd);
    chip.addEventListener('dblclick',  () => openModal(evt.id));
    pool.appendChild(chip);
  });
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

let drag = { id: null, placeholder: null };

function onDragStart(e) {
  drag.id = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  drag.placeholder = document.createElement('div');
  drag.placeholder.className = 'drop-placeholder';
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  drag.placeholder?.remove();
  drag.placeholder = null;
  document.querySelectorAll('.hour-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
  document.querySelectorAll('.pool-area.drag-over').forEach(c => c.classList.remove('drag-over'));
  drag.id = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const cell   = e.currentTarget;
  const dayCol = cell.closest('.day-col');
  if (!dayCol || !drag.placeholder) return;

  document.querySelectorAll('.hour-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
  cell.classList.add('drag-over');

  const targetHour = parseInt(cell.dataset.hour, 10);
  const evt        = state.events.find(ev => ev.id === drag.id);
  const dur        = evt?.duration || 1;
  const offset     = targetHour - START_HOUR;

  drag.placeholder.style.top    = `calc(var(--day-header-h) + ${offset} * var(--hour-height))`;
  drag.placeholder.style.height = `calc(${dur} * var(--hour-height) - 4px)`;

  if (drag.placeholder.parentElement !== dayCol) {
    drag.placeholder.remove();
    dayCol.appendChild(drag.placeholder);
  }
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const cell   = e.currentTarget;
  const dayCol = cell.closest('.day-col');
  cell.classList.remove('drag-over');
  drag.placeholder?.remove();
  drag.placeholder = null;
  if (!drag.id) return;

  const evt = state.events.find(ev => ev.id === drag.id);
  if (!evt) return;
  evt.day  = parseInt(dayCol.dataset.day, 10);
  evt.hour = parseInt(cell.dataset.hour, 10);
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

// ── Travel times (OSRM) ──────────────────────────────────────────────────────

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

    const dayEvents = state.events
      .filter(e => e.day === day && e.hour != null && e.location?.lat != null)
      .sort((a, b) => a.hour - b.hour);

    for (let i = 0; i < dayEvents.length - 1; i++) {
      if (signal.aborted) return;
      const a = dayEvents[i];
      const b = dayEvents[i + 1];

      const aEndHour = a.hour + (a.duration || 1);
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

      const badge = document.createElement('span');
      badge.className = `travel-badge${isWarn ? ' travel-badge-warn' : ''}`;
      badge.innerHTML = label;
      indicator.appendChild(badge);
      col.appendChild(indicator);
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
    // Re-apply filtered-out class without full re-render
    document.querySelectorAll('.event-card[data-id]').forEach(card => {
      const evt = state.events.find(e => e.id === card.dataset.id);
      if (evt) card.classList.toggle('filtered-out', !eventMatchesView(evt));
    });
    document.querySelectorAll('.event-chip[data-id]').forEach(chip => {
      const evt = state.events.find(e => e.id === chip.dataset.id);
      if (evt) chip.classList.toggle('dimmed', !eventMatchesView(evt));
    });
    if (activeTab === 'map') renderMap();
  });
});

// ── Tab switching ─────────────────────────────────────────────────────────────

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b === btn));
    calendarView.classList.toggle('hidden', activeTab !== 'calendar');
    mapView.classList.toggle('hidden',      activeTab !== 'map');
    mapLegend.classList.toggle('hidden',    activeTab !== 'map');

    if (activeTab === 'map') {
      // Leaflet needs the container visible before init
      setTimeout(() => { initMap(); renderMapDayStrip(); renderMap(); }, 50);
    } else {
      // Recalculate layout after returning to calendar
      updateHourHeight();
      repositionAllCards();
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
  const eventsWithCoords = state.events.filter(e =>
    e.location?.lat != null && e.location?.lng != null &&
    eventMatchesView(e) &&
    (mapDayFilter === null || e.day === mapDayFilter)
  );

  eventsWithCoords.forEach(evt => {
    const color  = CAT_COLOR[evt.category] || CAT_COLOR.other;
    const marker = L.circleMarker([evt.location.lat, evt.location.lng], {
      radius: 9, fillColor: color, color: '#fff',
      weight: 2, opacity: 1, fillOpacity: 0.9,
    });

    const dayLbl  = evt.day != null ? getDayLabel(evt.day) : null;
    const dayStr  = dayLbl ? `Day ${dayLbl.num} · ${dayLbl.dow} ${dayLbl.date}` : 'Unscheduled';
    const timeStr = evt.hour != null ? formatHour(evt.hour) : '';
    const people  = (evt.people || []).map(p => PEOPLE_LABEL[p] || p).join(', ');

    marker.bindPopup(`
      <div class="map-popup-title">${escHtml(evt.title)}</div>
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
// return { open: bool, closesAt: "HH:MM" | null, opensAt: "HH:MM" | null }
function hoursStatusAt(periods, dowJS, hour) {
  for (const p of periods) {
    if (p.open.day !== dowJS) continue;
    const openH  = parseInt(p.open.time.slice(0, 2), 10);
    const openM  = parseInt(p.open.time.slice(2, 4), 10);
    const closeH = p.close ? parseInt(p.close.time.slice(0, 2), 10) : 24;
    const closeM = p.close ? parseInt(p.close.time.slice(2, 4), 10) : 0;
    if (hour * 60 >= openH * 60 + openM && hour * 60 < closeH * 60 + closeM) {
      return { open: true, closesAt: p.close ? formatHour(closeH) : null };
    }
  }
  // Find next open window to report "opens at"
  const todayPeriods = periods.filter(p => p.open.day === dowJS);
  if (todayPeriods.length) {
    const next = todayPeriods.sort((a, b) => parseInt(a.open.time) - parseInt(b.open.time))[0];
    const oh = parseInt(next.open.time.slice(0, 2), 10);
    return { open: false, opensAt: formatHour(oh) };
  }
  return { open: false, opensAt: null };
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
  const hourVal = evtTime.value !== '' ? parseInt(evtTime.value, 10) : null;

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
        warningHtml = `<div class="place-hours-warn">⚠️ Closed at this time${escHtml(hint)}</div>`;
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
  HOURS.forEach(h => evtTime.appendChild(new Option(formatHour(h), h)));
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
  const hourVal = evtTime.value !== '' ? parseInt(evtTime.value, 10) : null;

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
updateHomeButton();
render();
