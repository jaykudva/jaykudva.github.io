require('dotenv').config();
const express          = require('express');
const cors             = require('cors');
const { createClient } = require('@supabase/supabase-js');
const WebSocket        = require('ws');

const app  = express();
const PORT = process.env.PORT || 3005;

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

function requireConductor(req, res, next) {
  const header = req.headers.authorization;
  const password = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Dispatch not configured' });
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Dispatch does not recognize you.' });
  }
  next();
}

const PHASES = ['pre', 'enroute', 'at', 'done'];
const DEFAULT_STATE = { id: 1, phase: 'pre', stop: 0, advisory: null, service_begins: null, stops_public: false };

// ── Public: where is the train ─────────────────────────────────────────────

app.get('/api/status', async (req, res) => {
  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await sb
    .from('crawl_state')
    .select('phase, stop, advisory, service_begins, stops_public, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) return res.status(502).json({ error: error.message });
  res.json(data || { ...DEFAULT_STATE, updated_at: null });
});

// ── Dispatch office ─────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Dispatch not configured' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Dispatch does not recognize you.' });
  }
  res.json({ ok: true });
});

app.post('/api/status', requireConductor, async (req, res) => {
  const { phase, stop, advisory, service_begins, stops_public } = req.body || {};
  const patch = { updated_at: new Date().toISOString() };

  if (phase !== undefined) {
    if (!PHASES.includes(phase)) return res.status(400).json({ error: 'Unknown phase.' });
    patch.phase = phase;
  }
  if (stop !== undefined) {
    const n = parseInt(stop, 10);
    if (!Number.isInteger(n) || n < 0 || n > 99) {
      return res.status(400).json({ error: 'Stop must be a small whole number.' });
    }
    patch.stop = n;
  }
  if (advisory !== undefined) {
    if (advisory !== null && typeof advisory !== 'string') {
      return res.status(400).json({ error: 'Advisory must be text or null.' });
    }
    patch.advisory = advisory?.trim() || null;
  }
  if (service_begins !== undefined) {
    if (service_begins === null) {
      patch.service_begins = null;
    } else {
      const d = new Date(service_begins);
      if (isNaN(d)) return res.status(400).json({ error: 'Departure must be a valid date/time.' });
      patch.service_begins = d.toISOString();
    }
  }
  if (stops_public !== undefined) {
    if (typeof stops_public !== 'boolean') {
      return res.status(400).json({ error: 'stops_public must be true or false.' });
    }
    patch.stops_public = stops_public;
  }
  if (Object.keys(patch).length === 1) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await sb
    .from('crawl_state')
    .upsert({ id: 1, ...patch })
    .select('phase, stop, advisory, service_begins, stops_public, updated_at')
    .single();

  if (error) return res.status(502).json({ error: error.message });
  res.json(data);
});

module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => console.log(`BJAY BCRAWL Dispatch on http://localhost:${PORT}`));
}
