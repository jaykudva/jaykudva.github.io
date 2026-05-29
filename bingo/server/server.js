require('dotenv').config();
const express          = require('express');
const cors             = require('cors');
const { createClient } = require('@supabase/supabase-js');
const WebSocket        = require('ws');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      || (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN);
    cb(allowed ? null : new Error('CORS blocked'), allowed);
  },
}));

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: WebSocket } });
}

function isTestUser(username) {
  return username.includes('_test') || username === 'username';
}

function fakeBoard(type) {
  return Array.from({ length: 25 }, (_, i) => {
    if (i === 12) return { ...FREE_SQUARE_CELL, completed: false, free: true };
    return {
      id:          `fake-${i}`,
      title:       'Sample question',
      description: 'The real questions are a surprise. This is just a placeholder so you can see how the game works.',
      type:        'honor',
      completed:   false,
    };
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) return res.status(401).json({ error: 'Unauthorized' });

  const decoded  = Buffer.from(header.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { data: user } = await sb
    .from('bingo_users')
    .select('id, username, display_name, is_admin, password')
    .eq('username', username.toLowerCase().trim())
    .single();

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const FREE_SQUARE    = null; // sentinel stored at index 12
const FREE_SQUARE_ID = '00000000-0000-0000-0000-000000000001';
const FREE_SQUARE_CELL = {
  id:          FREE_SQUARE_ID,
  title:       'Arigato',
  description: 'Send Jay a voice note of you saying "arigatou gozaimasu." Pronunciation counts — at least a little.',
  type:        'honor',
  completed:   false,
};

async function getOrCreateBoard(sb, userId, boardType) {
  const { data: existing } = await sb
    .from('bingo_board_assignments')
    .select('question_ids')
    .eq('user_id', userId)
    .eq('board', boardType)
    .single();

  // Auto-migrate boards created before the free square was added
  if (existing) {
    const hasFreeSquare = existing.question_ids.length === 25 && existing.question_ids[12] === FREE_SQUARE;
    if (hasFreeSquare) return existing.question_ids;
    // Old format — delete and regenerate below
    await sb.from('bingo_board_assignments').delete().eq('user_id', userId).eq('board', boardType);
  }

  const { data: questions, error } = await sb
    .from('bingo_questions')
    .select('id')
    .eq('board', boardType);

  if (error || !questions?.length) throw new Error(`No questions found for board: ${boardType}`);
  if (questions.length < 24) throw new Error(`Need at least 24 questions for ${boardType} board, only have ${questions.length}`);

  const picked = shuffle(questions.map(q => q.id)).slice(0, 24);
  // Insert free square sentinel at center position
  picked.splice(12, 0, FREE_SQUARE);

  const { error: insertErr } = await sb
    .from('bingo_board_assignments')
    .insert({ user_id: userId, board: boardType, question_ids: picked });

  if (insertErr) throw new Error(insertErr.message);
  return picked;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const sb = getSupabase();
  const { data: user } = await sb
    .from('bingo_users')
    .select('id, username, display_name, is_admin, password')
    .eq('username', username.toLowerCase().trim())
    .single();

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  res.json({ id: user.id, username: user.username, displayName: user.display_name, isAdmin: user.is_admin });
});

app.get('/api/me', requireAuth, (req, res) => {
  const { id, username, display_name, is_admin } = req.user;
  res.json({ id, username, displayName: display_name, isAdmin: is_admin });
});

// ── Board ──────────────────────────────────────────────────────────────────────

app.get('/api/board/:type', requireAuth, async (req, res) => {
  const { type } = req.params;
  if (!['standard', 'extra'].includes(type)) return res.status(400).json({ error: 'Invalid board type' });

  if (isTestUser(req.user.username)) {
    return res.json({ board: type, cells: fakeBoard(type) });
  }

  const sb = getSupabase();

  try {
    const questionIds = await getOrCreateBoard(sb, req.user.id, type);

    const realIds     = questionIds.filter(id => id !== FREE_SQUARE);
    const completionIds = [...realIds, FREE_SQUARE_ID];
    const [{ data: questions }, { data: completions }] = await Promise.all([
      sb.from('bingo_questions').select('id, title, description, type').in('id', realIds),
      sb.from('bingo_completions').select('question_id').eq('user_id', req.user.id).in('question_id', completionIds),
    ]);

    const completedSet = new Set((completions || []).map(c => c.question_id));
    const questionMap  = Object.fromEntries((questions || []).map(q => [q.id, q]));

    const cells = questionIds.map(qid => {
      if (qid === FREE_SQUARE) {
        return { ...FREE_SQUARE_CELL, completed: completedSet.has(FREE_SQUARE_ID), free: true };
      }
      const q = questionMap[qid];
      return { id: qid, title: q?.title ?? '?', description: q?.description ?? '', type: q?.type ?? 'honor', completed: completedSet.has(qid) };
    });

    res.json({ board: type, cells });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/players/:userId/board/:type', requireAuth, async (req, res) => {
  const { userId, type } = req.params;
  if (!['standard', 'extra'].includes(type)) return res.status(400).json({ error: 'Invalid board type' });

  // Look up the target user to check if they're a test user
  const sb0 = getSupabase();
  const { data: targetUser } = await sb0.from('bingo_users').select('username').eq('id', userId).single();
  if (targetUser && isTestUser(targetUser.username)) {
    return res.json({ board: type, cells: fakeBoard(type) });
  }

  const sb = getSupabase();
  const { data: assignment } = await sb
    .from('bingo_board_assignments')
    .select('question_ids')
    .eq('user_id', userId)
    .eq('board', type)
    .single();

  if (!assignment) return res.json({ board: type, cells: null });

  const questionIds = assignment.question_ids;

  const realIds       = questionIds.filter(id => id !== FREE_SQUARE);
  const completionIds = [...realIds, FREE_SQUARE_ID];
  const [{ data: questions }, { data: completions }] = await Promise.all([
    sb.from('bingo_questions').select('id, title').in('id', realIds),
    sb.from('bingo_completions').select('question_id').eq('user_id', userId).in('question_id', completionIds),
  ]);

  const completedSet = new Set((completions || []).map(c => c.question_id));
  const questionMap  = Object.fromEntries((questions || []).map(q => [q.id, q]));

  const cells = questionIds.map(qid => {
    if (qid === FREE_SQUARE) return { ...FREE_SQUARE_CELL, completed: completedSet.has(FREE_SQUARE_ID), free: true };
    return { id: qid, title: questionMap[qid]?.title ?? '?', completed: completedSet.has(qid) };
  });

  res.json({ board: type, cells });
});

// ── Completions ───────────────────────────────────────────────────────────────

app.post('/api/complete', requireAuth, async (req, res) => {
  const { questionId, answerGiven } = req.body;
  if (!questionId) return res.status(400).json({ error: 'Missing questionId' });

  if (isTestUser(req.user.username)) return res.json({ ok: true });

  const sb = getSupabase();

  const { data: settings } = await sb
    .from('bingo_game_settings')
    .select('game_active')
    .eq('id', 'singleton')
    .single();
  if (settings && !settings.game_active) {
    return res.status(403).json({ error: 'The game has ended — no more completions!' });
  }

  const { data: question } = await sb
    .from('bingo_questions')
    .select('id, type, correct_answer')
    .eq('id', questionId)
    .single();

  if (!question) return res.status(404).json({ error: 'Question not found' });

  if (question.type === 'answer') {
    const given    = (answerGiven || '').trim().toLowerCase();
    const expected = (question.correct_answer || '').trim().toLowerCase();
    if (!given) return res.status(400).json({ error: 'Answer is required' });
    if (given !== expected) return res.status(400).json({ error: 'Wrong answer', correct: false });
  }

  const { error } = await sb.from('bingo_completions')
    .upsert({ user_id: req.user.id, question_id: questionId, completed_at: new Date().toISOString() });

  if (error) return res.status(502).json({ error: error.message });
  res.json({ ok: true });
});

app.delete('/api/complete/:questionId', requireAuth, async (req, res) => {
  if (isTestUser(req.user.username)) return res.json({ ok: true });
  const sb = getSupabase();
  const { error } = await sb.from('bingo_completions')
    .delete()
    .eq('user_id', req.user.id)
    .eq('question_id', req.params.questionId);
  if (error) return res.status(502).json({ error: error.message });
  res.json({ ok: true });
});

// ── Game state ────────────────────────────────────────────────────────────────

app.get('/api/game-state', requireAuth, async (req, res) => {
  const sb = getSupabase();
  const { data } = await sb
    .from('bingo_game_settings')
    .select('game_active, started_at, ended_at')
    .eq('id', 'singleton')
    .single();
  res.json({
    active:    data?.game_active ?? true,
    startedAt: data?.started_at  ?? null,
    endedAt:   data?.ended_at    ?? null,
  });
});

app.post('/api/admin/game-state', requireAuth, requireAdmin, async (req, res) => {
  const { active } = req.body;
  const sb = getSupabase();
  const payload = { id: 'singleton', game_active: active };
  if (active)  { payload.started_at = new Date().toISOString(); payload.ended_at = null; }
  if (!active) { payload.ended_at   = new Date().toISOString(); }
  const { error } = await sb.from('bingo_game_settings').upsert(payload);
  if (error) return res.status(502).json({ error: error.message });
  res.json({ ok: true });
});

// ── Players ───────────────────────────────────────────────────────────────────

app.get('/api/players', requireAuth, async (req, res) => {
  const sb = getSupabase();

  const [{ data: users }, { data: completions }] = await Promise.all([
    sb.from('bingo_users').select('id, username, display_name').order('display_name'),
    sb.from('bingo_completions').select('user_id, bingo_questions(board)'),
  ]);

  const counts = {};
  for (const c of completions || []) {
    if (!counts[c.user_id]) counts[c.user_id] = { standard: 0, extra: 0 };
    const board = c.bingo_questions?.board;
    if (board) counts[c.user_id][board]++;
  }

  const players = (users || [])
    .filter(u => !isTestUser(u.username))
    .map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      completions: counts[u.id] || { standard: 0, extra: 0 },
    }))
    .sort((a, b) => {
      const totalA = a.completions.standard + a.completions.extra;
      const totalB = b.completions.standard + b.completions.extra;
      return totalB - totalA;
    });

  res.json({ players });
});

// ── Admin: Questions ──────────────────────────────────────────────────────────

app.get('/api/admin/questions', requireAuth, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb.from('bingo_questions').select('*').order('board').order('created_at');
  if (error) return res.status(502).json({ error: error.message });
  res.json({ questions: data });
});

app.post('/api/admin/questions', requireAuth, requireAdmin, async (req, res) => {
  const { board, title, description, type, correctAnswer } = req.body;
  if (!board || !title || !type) return res.status(400).json({ error: 'board, title, type required' });
  if (!['standard', 'extra'].includes(board)) return res.status(400).json({ error: 'Invalid board' });
  if (!['answer', 'honor'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  if (type === 'answer' && !correctAnswer) return res.status(400).json({ error: 'correctAnswer required' });

  const sb = getSupabase();
  const { data, error } = await sb
    .from('bingo_questions')
    .insert({ board, title, description: description || null, type, correct_answer: correctAnswer || null })
    .select().single();
  if (error) return res.status(502).json({ error: error.message });
  res.json({ question: data });
});

app.put('/api/admin/questions/:id', requireAuth, requireAdmin, async (req, res) => {
  const { board, title, description, type, correctAnswer } = req.body;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('bingo_questions')
    .update({ board, title, description: description || null, type, correct_answer: correctAnswer || null })
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(502).json({ error: error.message });
  res.json({ question: data });
});

app.delete('/api/admin/questions/:id', requireAuth, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const { error } = await sb.from('bingo_questions').delete().eq('id', req.params.id);
  if (error) return res.status(502).json({ error: error.message });
  res.json({ ok: true });
});

// ── Admin: Users ──────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('bingo_users')
    .select('id, username, display_name, is_admin, created_at')
    .order('display_name');
  if (error) return res.status(502).json({ error: error.message });
  res.json({ users: data });
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, displayName, isAdmin } = req.body;
  if (!username || !password || !displayName) return res.status(400).json({ error: 'username, password, displayName required' });

  const sb = getSupabase();
  const { data, error } = await sb
    .from('bingo_users')
    .insert({ username: username.toLowerCase().trim(), password, display_name: displayName, is_admin: isAdmin || false })
    .select('id, username, display_name, is_admin').single();
  if (error) return res.status(502).json({ error: error.message });
  res.json({ user: data });
});

app.post('/api/admin/reset-board', requireAuth, requireAdmin, async (req, res) => {
  const { userId, board } = req.body;
  if (!userId || !board) return res.status(400).json({ error: 'userId and board required' });

  const sb = getSupabase();
  const { error } = await sb.from('bingo_board_assignments')
    .delete().eq('user_id', userId).eq('board', board);
  if (error) return res.status(502).json({ error: error.message });

  // Also clear completions for that board's questions so the slate is clean
  const { data: questions } = await sb.from('bingo_questions').select('id').eq('board', board);
  if (questions?.length) {
    await sb.from('bingo_completions')
      .delete()
      .eq('user_id', userId)
      .in('question_id', questions.map(q => q.id));
  }

  res.json({ ok: true });
});

module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Bingo API on http://localhost:${PORT}`));
}
