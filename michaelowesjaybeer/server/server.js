require('dotenv').config();
const express          = require('express');
const cors             = require('cors');
const { createClient } = require('@supabase/supabase-js');
const WebSocket        = require('ws');

const app  = express();
const PORT = process.env.PORT || 3004;

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

function requireClerk(req, res, next) {
  const header = req.headers.authorization;
  const password = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Bureau not configured' });
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'The Clerk does not recognize you.' });
  }
  next();
}

// ── Punitive interest ──────────────────────────────────────────────────────────
// Settlements apply FIFO (First In, First Owed): credits retire the oldest
// beers first. Once 3+ pending beers are aged past 21 days, 1 beer accrues
// immediately, plus 1 per full week the delinquency persists. Principal only.

const WEEK_MS  = 7 * 86400000;
const AGING_MS = 21 * 86400000;

function computeInterest(entries) {
  const beers = [];
  for (const e of entries) {
    if (e.kind !== 'debit') continue;
    const t = new Date(e.occurred_on).getTime();
    for (let i = 0; i < e.quantity; i++) beers.push(t);
  }
  beers.sort((a, b) => a - b); // oldest first
  const settled = entries
    .filter(e => e.kind === 'credit')
    .reduce((n, e) => n + e.quantity, 0);

  const pending = beers.slice(settled); // FIFO: oldest `settled` beers retired
  const now  = Date.now();
  const aged = pending.filter(t => now - t >= AGING_MS).length;
  if (aged < 3) {
    return { interest: 0, active: false, aged, since: null, next_accrual: null };
  }

  // Delinquency began when the 3rd-oldest pending beer turned 21 days old
  const since    = pending[2] + AGING_MS;
  const interest = 1 + Math.floor((now - since) / WEEK_MS);
  return { interest, active: true, aged, since, next_accrual: since + interest * WEEK_MS };
}

// ── Public: the ledger ─────────────────────────────────────────────────────────
// Double-entry, loosely speaking: 'debit' = beers Michael owes (beer bought for
// him), 'credit' = beers settled (Michael covered something).

app.get('/api/ledger', async (req, res) => {
  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { data: entries, error } = await sb
    .from('beer_ledger')
    .select('id, occurred_on, kind, quantity, location, memorandum, created_at')
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return res.status(502).json({ error: error.message });

  const owed    = entries.filter(e => e.kind === 'debit').reduce((n, e) => n + e.quantity, 0);
  const settled = entries.filter(e => e.kind === 'credit').reduce((n, e) => n + e.quantity, 0);

  const principal = owed - settled;
  const { interest, ...accrual } = computeInterest(entries);

  res.json({
    outstanding: principal + interest,
    principal,
    interest,
    accrual,
    owed,
    settled,
    entries,
  });
});

// ── Clerk's office ─────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Bureau not configured' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'The Clerk does not recognize you.' });
  }
  res.json({ ok: true });
});

app.post('/api/entries', requireClerk, async (req, res) => {
  const { occurred_on, kind = 'debit', quantity = 1, location, memorandum } = req.body || {};

  if (!occurred_on) return res.status(400).json({ error: 'A date is required.' });
  if (!['debit', 'credit'].includes(kind)) return res.status(400).json({ error: 'Unknown entry kind.' });
  const qty = parseInt(quantity, 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    return res.status(400).json({ error: 'Quantity must be a whole number of beers (1–99).' });
  }
  if (kind === 'debit' && !location?.trim()) {
    return res.status(400).json({ error: 'An establishment is required for new obligations.' });
  }

  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await sb
    .from('beer_ledger')
    .insert({
      occurred_on,
      kind,
      quantity:   qty,
      location:   location?.trim() || null,
      memorandum: memorandum?.trim() || null,
    })
    .select()
    .single();

  if (error) return res.status(502).json({ error: error.message });
  res.json(data);
});

app.patch('/api/entries/:id', requireClerk, async (req, res) => {
  const { occurred_on, quantity, location, memorandum } = req.body || {};
  const patch = {};
  if (occurred_on !== undefined) patch.occurred_on = occurred_on;
  if (quantity    !== undefined) {
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: 'Quantity must be a whole number of beers (1–99).' });
    }
    patch.quantity = qty;
  }
  if (location   !== undefined) patch.location = location?.trim() || null;
  if (memorandum !== undefined) patch.memorandum = memorandum?.trim() || null;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to amend.' });

  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await sb
    .from('beer_ledger')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(502).json({ error: error.message });
  res.json(data);
});

app.delete('/api/entries/:id', requireClerk, async (req, res) => {
  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { error } = await sb.from('beer_ledger').delete().eq('id', req.params.id);
  if (error) return res.status(502).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Bureau of Beverage Debt on http://localhost:${PORT}`));
}
