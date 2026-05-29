// ── Config ────────────────────────────────────────────────────────────────────
// After deploying to Vercel, replace the PROD url with your actual deployment url.
const API =
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3002'
    : 'https://japan-bingo.vercel.app';

// ── State ──────────────────────────────────────────────────────────────────────
let me            = null;   // { id, username, displayName, isAdmin, password }
let currentBoard  = 'standard';
let boardCache    = { standard: null, extra: null };
let modalCell     = null;
let viewedPlayer  = null;
let adminTab      = 'questions';
let gameActive    = true;
let gameEndedAt   = null;

// ── API helpers ────────────────────────────────────────────────────────────────

function authHeader() {
  if (!me) return {};
  return {
    'Authorization': 'Basic ' + btoa(me.username + ':' + me.password),
    'Content-Type':  'application/json',
  };
}

async function api(method, path, body) {
  const headers = authHeader();
  if (body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

async function doLogin() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  const errEl    = $('login-error');
  errEl.classList.add('hidden');
  $('login-btn').textContent = '…';

  try {
    const data = await api('POST', '/api/login', { username, password });
    me = { ...data, password };
    localStorage.setItem('bingo_me', JSON.stringify(me));
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    $('login-btn').textContent = 'Let\'s go';
  }
}

function doLogout() {
  me         = null;
  boardCache = { standard: null, extra: null };
  localStorage.removeItem('bingo_me');
  showView('login');
  $('bottom-nav').classList.add('hidden');
}

async function enterApp() {
  $('bottom-nav').classList.remove('hidden');
  if (me.isAdmin) $('admin-nav-btn').style.display = '';
  $('header-name').textContent = me.displayName;
  await loadGameState();
  showView('game');
  setNavActive('game');
  loadMyBoard(currentBoard);
}

async function loadGameState() {
  try {
    const data  = await api('GET', '/api/game-state');
    gameActive  = data.active;
    gameEndedAt = data.endedAt;
    $('game-over-banner').classList.toggle('hidden', gameActive);
  } catch {
    gameActive = true;
  }
}

// ── Routing / views ────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + name).classList.remove('hidden');
}

function setNavActive(view) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  if (btn) btn.classList.add('active');
}

// ── Board (mine) ───────────────────────────────────────────────────────────────

async function loadMyBoard(type) {
  currentBoard = type;
  document.querySelectorAll('#view-game .pill').forEach(b => {
    b.classList.toggle('active', b.dataset.board === type);
  });

  const grid = $('my-grid');

  if (boardCache[type]) {
    renderGrid(grid, boardCache[type], true);
    return;
  }

  loadingGrid(grid);

  try {
    const data        = await api('GET', '/api/board/' + type);
    boardCache[type]  = data.cells;
    renderGrid(grid, data.cells, true);
  } catch (err) {
    grid.innerHTML = `<div class="empty" style="grid-column:span 5">${esc(err.message)}</div>`;
  }
}

function loadingGrid(grid) {
  grid.innerHTML = Array(25).fill('<div class="bingo-cell loading"></div>').join('');
}

function renderGrid(grid, cells, interactive) {
  const winSet = getBingoWinSet(cells);
  if ($('bingo-banner')) $('bingo-banner').classList.toggle('hidden', winSet.size === 0);

  grid.innerHTML = cells.map((cell, i) => {
    const isFree = cell.free === true;
    const done   = cell.completed;
    const win    = winSet.has(i);
    const cls    = ['bingo-cell', isFree ? 'free' : '', done && !isFree ? 'completed' : '', win ? 'bingo-line' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-i="${i}">
      ${done && !isFree ? '<span class="cell-check">✓</span>' : ''}
      <span>${esc(cell.title)}</span>
    </div>`;
  }).join('');

  if (interactive) {
    grid.querySelectorAll('.bingo-cell').forEach(el => {
      el.addEventListener('click', () => openModal(cells[+el.dataset.i]));
    });
  }
}

// ── Bingo detection ────────────────────────────────────────────────────────────

function getBingoWinSet(cells) {
  const done  = new Set(cells.map((c, i) => c.completed ? i : -1).filter(i => i >= 0));
  const lines = [
    // rows
    [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],
    // cols
    [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],
    // diagonals
    [0,6,12,18,24],[4,8,12,16,20],
  ];
  const winning = new Set();
  for (const line of lines) {
    if (line.every(i => done.has(i))) line.forEach(i => winning.add(i));
  }
  return winning;
}

// ── Square modal ───────────────────────────────────────────────────────────────

function openModal(cell) {
  if (!gameActive && !cell.completed) return;
  modalCell = cell;

  const badge = $('modal-badge');
  badge.className = 'badge ' + cell.type;
  badge.textContent = cell.type === 'answer' ? '🔑 Answer Required' : '🤞 Honor System';

  $('modal-title').textContent     = cell.title;
  $('modal-desc').textContent      = cell.description || '';
  $('modal-answer-error').classList.add('hidden');
  $('modal-answer-input').value    = '';
  $('modal-honor-check').checked   = false;

  // Reset all interactive state
  $('modal-submit-btn').disabled   = false;
  $('modal-honor-btn').disabled    = false;
  $('modal-answer-input').disabled = false;

  show('modal-answer-section', cell.type === 'answer');
  show('modal-honor-section',  cell.type === 'honor');
  show('modal-unmark-btn',     cell.completed);

  if (cell.completed) {
    if (cell.type === 'answer') {
      $('modal-answer-input').disabled = true;
      $('modal-submit-btn').disabled   = true;
      $('modal-answer-input').placeholder = 'Already completed ✓';
    } else {
      $('modal-honor-check').checked   = true;
      $('modal-honor-check').disabled  = true;
      $('modal-honor-btn').disabled    = true;
    }
  } else {
    $('modal-answer-input').placeholder = 'Type your answer…';
    $('modal-honor-check').disabled = false;
  }

  $('modal-overlay').classList.remove('hidden');
  if (cell.type === 'answer' && !cell.completed) {
    setTimeout(() => $('modal-answer-input').focus(), 120);
  }
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
  modalCell = null;
}

async function submitAnswer() {
  if (!modalCell) return;
  const answer = $('modal-answer-input').value.trim();
  if (!answer) return;

  const errEl = $('modal-answer-error');
  errEl.classList.add('hidden');
  $('modal-submit-btn').disabled    = true;
  $('modal-submit-btn').textContent = '…';

  try {
    await api('POST', '/api/complete', { questionId: modalCell.id, answerGiven: answer });
    updateCellLocally(modalCell.id, true);
    closeModal();
  } catch (err) {
    errEl.textContent = err.message === 'Wrong answer' ? '❌ That\'s not right — try again!' : err.message;
    errEl.classList.remove('hidden');
    $('modal-submit-btn').disabled    = false;
    $('modal-submit-btn').textContent = 'Submit Answer';
  }
}

async function submitHonor() {
  if (!modalCell) return;
  if (!$('modal-honor-check').checked) {
    $('modal-honor-check').animate(
      [{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }],
      { duration: 250 }
    );
    return;
  }
  $('modal-honor-btn').disabled    = true;
  $('modal-honor-btn').textContent = '…';
  try {
    await api('POST', '/api/complete', { questionId: modalCell.id });
    updateCellLocally(modalCell.id, true);
    closeModal();
  } catch (err) {
    alert(err.message);
    $('modal-honor-btn').disabled    = false;
    $('modal-honor-btn').textContent = 'Mark Complete';
  }
}

async function unmarkSquare() {
  if (!modalCell || !confirm('Unmark this square?')) return;
  try {
    await api('DELETE', '/api/complete/' + modalCell.id);
    updateCellLocally(modalCell.id, false);
    closeModal();
  } catch (err) {
    alert(err.message);
  }
}

function updateCellLocally(questionId, completed) {
  const cells = boardCache[currentBoard];
  if (!cells) return;
  const cell = cells.find(c => c.id === questionId);
  if (cell) cell.completed = completed;
  renderGrid($('my-grid'), cells, true);
}

// ── Players ────────────────────────────────────────────────────────────────────

async function loadPlayers() {
  showView('players');
  setNavActive('players');
  await loadGameState();
  $('players-list').innerHTML = '<div class="empty"><div class="empty-icon">⏳</div></div>';
  try {
    const data = await api('GET', '/api/players');
    renderPlayers(data.players);
  } catch (err) {
    $('players-list').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function renderPlayers(players) {
  if (!players.length) {
    $('players-list').innerHTML = '<div class="empty"><div class="empty-icon">👥</div><p>No players yet</p></div>';
    return;
  }

  const rankEmoji = ['🥇', '🥈', '🥉'];
  const heading   = gameActive ? 'Live Standings' : '🎌 Final Results';
  const endNote   = !gameActive && gameEndedAt
    ? `Game ended ${new Date(gameEndedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';

  $('players-list').innerHTML = `
    <div class="leaderboard-header">${heading}${endNote ? ` · ${endNote}` : ''}</div>
    ${players.map((p, i) => {
      const total   = p.completions.standard + p.completions.extra;
      const isFirst = i === 0 && total > 0;
      const rank    = rankEmoji[i] ?? `${i + 1}`;
      return `
        <div class="player-row${isFirst && !gameActive ? ' winner' : ''}" data-id="${p.id}" data-name="${esc(p.displayName)}">
          <div class="player-rank${i < 3 ? ' top' : ''}">${rank}</div>
          <div style="flex:1;min-width:0">
            <div class="player-name">${esc(p.displayName)}${isFirst && !gameActive ? ' 🏆' : ''}</div>
            <div class="player-sub">Std: ${p.completions.standard}/25 · Xtr: ${p.completions.extra}/25</div>
          </div>
          <div class="player-score">${total}</div>
        </div>`;
    }).join('')}
  `;

  $('players-list').querySelectorAll('.player-row').forEach(el => {
    el.addEventListener('click', () => openPlayerBoard({ id: el.dataset.id, displayName: el.dataset.name }));
  });
}

// ── Player board (read-only) ───────────────────────────────────────────────────

function openPlayerBoard(player) {
  viewedPlayer = player;
  $('player-board-title').textContent = player.displayName;
  showView('player-board');
  document.querySelectorAll('#player-board-pills .pill').forEach(b => {
    b.classList.toggle('active', b.dataset.board === 'standard');
  });
  loadPlayerBoard('standard');
}

async function loadPlayerBoard(type) {
  document.querySelectorAll('#player-board-pills .pill').forEach(b => {
    b.classList.toggle('active', b.dataset.board === type);
  });
  const grid = $('player-grid');
  loadingGrid(grid);
  try {
    const data = await api('GET', `/api/players/${viewedPlayer.id}/board/${type}`);
    if (!data.cells) {
      grid.innerHTML = '<div class="empty" style="grid-column:span 5"><div class="empty-icon">🎲</div><p>Board not generated yet</p></div>';
      return;
    }
    renderGrid(grid, data.cells, false);
  } catch (err) {
    grid.innerHTML = `<div class="empty" style="grid-column:span 5">${esc(err.message)}</div>`;
  }
}

// ── Admin ──────────────────────────────────────────────────────────────────────

async function openAdmin() {
  showView('admin');
  setNavActive('admin');
  await loadGameState();
  updateAdminGameControl();
  switchAdminTab(adminTab);
}

function updateAdminGameControl() {
  const label  = $('game-status-label');
  const sub    = $('game-status-sub');
  const btn    = $('game-toggle-btn');
  if (gameActive) {
    label.textContent = '🟢 Game is live';
    sub.textContent   = 'Players can complete squares';
    btn.textContent   = 'End Game';
    btn.className     = 'game-toggle-btn end';
  } else {
    label.textContent = '🔴 Game over';
    sub.textContent   = gameEndedAt
      ? `Ended at ${new Date(gameEndedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '';
    btn.textContent   = 'Restart Game';
    btn.className     = 'game-toggle-btn start';
  }
}

async function toggleGameState() {
  const newActive = !gameActive;
  const confirm_  = newActive
    ? confirm('Restart the game? Players can complete squares again.')
    : confirm('End the game? Players will be locked out and the leaderboard will be shown.');
  if (!confirm_) return;

  $('game-toggle-btn').disabled = true;
  try {
    await api('POST', '/api/admin/game-state', { active: newActive });
    await loadGameState();
    updateAdminGameControl();
  } catch (err) {
    alert(err.message);
  } finally {
    $('game-toggle-btn').disabled = false;
  }
}

function switchAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  show('admin-questions-pane', tab === 'questions');
  show('admin-users-pane',     tab === 'users');
  if (tab === 'questions') loadAdminQuestions();
  else loadAdminUsers();
}

async function loadAdminQuestions() {
  const pane = $('admin-questions-pane');
  pane.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div></div>';
  try {
    const { questions } = await api('GET', '/api/admin/questions');
    const standard = questions.filter(q => q.board === 'standard');
    const extra    = questions.filter(q => q.board === 'extra');

    pane.innerHTML = `
      <p class="section-label">Standard (${standard.length} questions)</p>
      ${standard.map(qCard).join('') || '<p style="color:var(--muted);font-size:13px;margin-bottom:12px">No questions yet</p>'}
      <p class="section-label" style="margin-top:20px">Extra (${extra.length} questions)</p>
      ${extra.map(qCard).join('')   || '<p style="color:var(--muted);font-size:13px">No questions yet</p>'}
    `;

    pane.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = questions.find(x => x.id === btn.dataset.id);
        if (q) openQForm(q);
      });
    });

    pane.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this question?')) return;
        try {
          await api('DELETE', '/api/admin/questions/' + btn.dataset.id);
          loadAdminQuestions();
        } catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    pane.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

function qCard(q) {
  const meta = q.type === 'answer' ? `🔑 ${esc(q.correct_answer || '')}` : '🤞 Honor system';
  return `
    <div class="q-card">
      <div class="q-card-body">
        <div class="q-card-title">${esc(q.title)}</div>
        <div class="q-card-meta">${meta}</div>
      </div>
      <div class="q-card-actions">
        <button class="act-btn btn-edit" data-id="${q.id}">✏️</button>
        <button class="act-btn btn-del"  data-id="${q.id}">🗑️</button>
      </div>
    </div>`;
}

async function loadAdminUsers() {
  const pane = $('admin-users-pane');
  pane.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div></div>';
  try {
    const { users } = await api('GET', '/api/admin/users');
    pane.innerHTML = `
      <p class="section-label">${users.length} players</p>
      ${users.map(u => `
        <div class="u-card">
          <div class="u-card-body">
            <div class="u-name">
              ${esc(u.display_name)}
              ${u.is_admin ? '<span class="admin-badge">admin</span>' : ''}
            </div>
            <div class="u-sub">@${esc(u.username)}</div>
          </div>
          <button class="reset-btn" data-id="${u.id}" data-board="standard">↺ Std</button>
          <button class="reset-btn" data-id="${u.id}" data-board="extra"    style="margin-left:4px">↺ Xtr</button>
        </div>
      `).join('')}
    `;

    pane.querySelectorAll('.reset-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const board = btn.dataset.board;
        if (!confirm(`Reset ${board} board for this player? This clears their layout and completions.`)) return;
        try {
          await api('POST', '/api/admin/reset-board', { userId: btn.dataset.id, board });
          alert('Board reset ✓');
        } catch (err) { alert(err.message); }
      });
    });
  } catch (err) {
    pane.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

// ── Question form ──────────────────────────────────────────────────────────────

function openQForm(q = null) {
  $('qf-id').value          = q?.id || '';
  $('qf-board').value       = q?.board || 'standard';
  $('qf-title').value       = q?.title || '';
  $('qf-description').value = q?.description || '';
  $('qf-type').value        = q?.type || 'honor';
  $('qf-answer').value      = q?.correct_answer || '';
  $('qform-heading').textContent = q ? 'Edit Question' : 'Add Question';
  $('qf-answer-group').classList.toggle('hidden', (q?.type || 'honor') !== 'answer');
  $('qform-overlay').classList.remove('hidden');
}

async function saveQForm() {
  const id   = $('qf-id').value;
  const body = {
    board:         $('qf-board').value,
    title:         $('qf-title').value.trim(),
    description:   $('qf-description').value.trim(),
    type:          $('qf-type').value,
    correctAnswer: $('qf-answer').value.trim(),
  };
  if (!body.title) return alert('Title is required');
  if (body.type === 'answer' && !body.correctAnswer) return alert('Correct answer is required for answer-type questions');

  $('qform-save-btn').disabled    = true;
  $('qform-save-btn').textContent = '…';
  try {
    if (id) await api('PUT',  '/api/admin/questions/' + id, body);
    else    await api('POST', '/api/admin/questions', body);
    $('qform-overlay').classList.add('hidden');
    loadAdminQuestions();
  } catch (err) {
    alert(err.message);
  } finally {
    $('qform-save-btn').disabled    = false;
    $('qform-save-btn').textContent = 'Save';
  }
}

// ── User form ──────────────────────────────────────────────────────────────────

function openUForm() {
  $('uf-displayname').value = '';
  $('uf-username').value    = '';
  $('uf-password').value    = '';
  $('uf-admin').checked     = false;
  $('uform-error').classList.add('hidden');
  $('uform-overlay').classList.remove('hidden');
}

async function saveUForm() {
  const body = {
    displayName: $('uf-displayname').value.trim(),
    username:    $('uf-username').value.trim(),
    password:    $('uf-password').value,
    isAdmin:     $('uf-admin').checked,
  };
  $('uform-error').classList.add('hidden');
  $('uform-save-btn').disabled    = true;
  $('uform-save-btn').textContent = '…';
  try {
    await api('POST', '/api/admin/users', body);
    $('uform-overlay').classList.add('hidden');
    loadAdminUsers();
  } catch (err) {
    $('uform-error').textContent = err.message;
    $('uform-error').classList.remove('hidden');
  } finally {
    $('uform-save-btn').disabled    = false;
    $('uform-save-btn').textContent = 'Add Player';
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function show(id, visible) {
  $(id).classList.toggle('hidden', !visible);
}

// ── Init ───────────────────────────────────────────────────────────────────────

function init() {
  // Restore session
  try {
    const saved = localStorage.getItem('bingo_me');
    if (saved) { me = JSON.parse(saved); enterApp(); }
    else showView('login');
  } catch { showView('login'); }

  // Login
  $('login-btn').addEventListener('click', doLogin);
  $('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Logout
  $('logout-btn').addEventListener('click', doLogout);

  // Bottom nav
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === 'game')    { showView('game'); setNavActive('game'); loadMyBoard(currentBoard); }
      if (v === 'players') loadPlayers();
      if (v === 'admin')   openAdmin();
    });
  });

  // Board pills (my board)
  document.querySelectorAll('#view-game .pill').forEach(btn => {
    btn.addEventListener('click', () => loadMyBoard(btn.dataset.board));
  });

  // Player board pills
  document.querySelectorAll('#player-board-pills .pill').forEach(btn => {
    btn.addEventListener('click', () => loadPlayerBoard(btn.dataset.board));
  });

  // Back from player board
  $('back-from-player').addEventListener('click', loadPlayers);

  // Players refresh
  $('players-refresh-btn').addEventListener('click', loadPlayers);

  // Square modal
  $('modal-close').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
  $('modal-submit-btn').addEventListener('click', submitAnswer);
  $('modal-honor-btn').addEventListener('click', submitHonor);
  $('modal-unmark-btn').addEventListener('click', unmarkSquare);
  $('modal-answer-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(); });

  // Admin game control
  $('game-toggle-btn').addEventListener('click', toggleGameState);

  // Admin tabs
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
  });

  // Admin FAB — context-sensitive
  $('admin-add-btn').addEventListener('click', () => {
    if (adminTab === 'questions') openQForm();
    else openUForm();
  });

  // Question form
  $('qform-close').addEventListener('click', () => $('qform-overlay').classList.add('hidden'));
  $('qform-overlay').addEventListener('click', e => { if (e.target === $('qform-overlay')) $('qform-overlay').classList.add('hidden'); });
  $('qform-save-btn').addEventListener('click', saveQForm);
  $('qf-type').addEventListener('change', () => {
    $('qf-answer-group').classList.toggle('hidden', $('qf-type').value !== 'answer');
  });

  // User form
  $('uform-close').addEventListener('click', () => $('uform-overlay').classList.add('hidden'));
  $('uform-overlay').addEventListener('click', e => { if (e.target === $('uform-overlay')) $('uform-overlay').classList.add('hidden'); });
  $('uform-save-btn').addEventListener('click', saveUForm);
}

document.addEventListener('DOMContentLoaded', init);
