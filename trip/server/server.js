require('dotenv').config();
const express               = require('express');
const cors                  = require('cors');
const { createClient }      = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Allow the static frontend (any localhost port + future prod domain)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      || (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN);
    cb(allowed ? null : new Error('CORS blocked'), allowed);
  }
}));

// GET /api/route?fromLat=&fromLng=&toLat=&toLng=
// Returns { distKm, driveMin, walkMin }
// Checks Supabase route_cache first; only calls GraphHopper on a cache miss.
app.get('/api/route', async (req, res) => {
  const { fromLat, fromLng, toLat, toLng } = req.query;

  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ error: 'Missing coordinates' });
  }

  // Normalise to 5 decimal places to maximise cache hits
  const cacheKey = `${parseFloat(fromLat).toFixed(5)},${parseFloat(fromLng).toFixed(5)}->${parseFloat(toLat).toFixed(5)},${parseFloat(toLng).toFixed(5)}`;

  // ── Check Supabase cache ──────────────────────────────────────────────────
  const sb = getSupabase();
  if (sb) {
    const { data: cached } = await sb
      .from('route_cache')
      .select('dist_km,drive_min,walk_min')
      .eq('key', cacheKey)
      .single();
    if (cached) {
      console.log('[route] cache hit:', cacheKey);
      return res.json({ distKm: cached.dist_km, driveMin: cached.drive_min, walkMin: cached.walk_min });
    }
  }

  // ── Call GraphHopper ──────────────────────────────────────────────────────
  const ghKey = process.env.GRAPHHOPPER_API_KEY;
  if (!ghKey) return res.status(500).json({ error: 'GRAPHHOPPER_API_KEY not set' });

  const url =
    `https://graphhopper.com/api/1/route` +
    `?point=${fromLat},${fromLng}` +
    `&point=${toLat},${toLng}` +
    `&profile=car` +
    `&locale=en` +
    `&key=${ghKey}`;

  try {
    const upstream = await fetch(url);
    const data     = await upstream.json();

    if (!data.paths?.length) {
      return res.status(502).json({ error: 'No route found', detail: data.message });
    }

    const path     = data.paths[0];
    const distKm   = path.distance / 1000;
    const driveMin = Math.round(path.time / 60000);
    const walkMin  = Math.round((distKm / 4.5) * 60);

    // ── Save to Supabase cache (awaited — fire-and-forget dies in Vercel) ──
    if (sb) {
      const { error: cacheErr } = await sb
        .from('route_cache')
        .upsert({ key: cacheKey, dist_km: distKm, drive_min: driveMin, walk_min: walkMin });
      if (cacheErr) console.warn('[route] cache write failed:', cacheErr.message);
      else console.log('[route] cached:', cacheKey);
    }

    res.json({ distKm, driveMin, walkMin });
  } catch (err) {
    console.error('[route] upstream error:', err.message);
    res.status(502).json({ error: 'Routing request failed' });
  }
});

// POST /api/routes/bulk  { keys: ["lat,lng->lat,lng", ...] }
// Returns { results: { [key]: { distKm, driveMin, walkMin } } } for all keys found in cache.
// Keys not in the DB are omitted — the client should fetch those individually via /api/route.
app.post('/api/routes/bulk', requirePassword, async (req, res) => {
  const { keys } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) return res.json({ results: {} });

  const sb = getSupabase();
  if (!sb) return res.json({ results: {} });

  const { data, error } = await sb
    .from('route_cache')
    .select('key,dist_km,drive_min,walk_min')
    .in('key', keys);

  if (error) {
    console.warn('[routes/bulk] query failed:', error.message);
    return res.json({ results: {} });
  }

  const results = {};
  for (const row of data || []) {
    results[row.key] = { distKm: row.dist_km, driveMin: row.drive_min, walkMin: row.walk_min };
  }
  console.log(`[routes/bulk] ${Object.keys(results).length}/${keys.length} cache hits`);
  res.json({ results });
});

// Fetch a URL with a browser-like User-Agent so Google doesn't serve a bot page.
async function browserFetch(url) {
  return fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
}

// Resolve a Google Maps URL to its canonical full form.
// maps.app.goo.gl are Firebase Dynamic Links — they serve a JS SPA on the server.
// Strategy: first try a plain (no UA) fetch which may get a direct 302 redirect;
// then try browser UA + body parsing as a fallback.
async function resolveGoogleMapsUrl(url) {
  // ── Pass 1: plain fetch (no User-Agent) — curl-like clients often get a raw 302 ──
  const plain = await fetch(url, { redirect: 'follow' });
  if (/google\.com\/maps\/place/.test(plain.url)) {
    console.log('[place] resolved via plain redirect:', plain.url);
    return plain.url;
  }

  // ── Pass 2: browser UA — may produce an HTTP redirect to a full Maps URL ──
  const res = await browserFetch(url);
  if (/google\.com\/maps\/place/.test(res.url)) {
    console.log('[place] resolved via browser-UA redirect:', res.url);
    return res.url;
  }

  const body = await res.text();

  // meta-refresh: <meta http-equiv="refresh" content="0; url=...">
  const metaMatch = body.match(/content=["']\d+;\s*url=([^"'&>]+)/i);
  if (metaMatch) {
    console.log('[place] resolved via meta-refresh');
    return decodeURIComponent(metaMatch[1].trim());
  }

  // JS redirect patterns
  const jsMatch = body.match(/location(?:\.href)?\s*[=\(]\s*["'](https:\/\/[^"']+\/maps[^"']+)["']/);
  if (jsMatch) {
    console.log('[place] resolved via JS redirect');
    return jsMatch[1];
  }

  // og:url meta tag (sometimes present on Firebase Dynamic Link preview pages)
  const ogMatch = body.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)
               || body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i);
  if (ogMatch && /google\.com\/maps/.test(ogMatch[1])) {
    console.log('[place] resolved via og:url');
    return ogMatch[1];
  }

  // Any Google Maps URL embedded anywhere in the full body
  const embedMatch = body.match(/https:\/\/(?:www\.)?google\.com\/maps\/place\/[^"'\s<>\\]+/);
  if (embedMatch) {
    console.log('[place] resolved via embedded URL');
    return embedMatch[0];
  }

  // Nothing worked — return null so the caller can surface a clear error
  console.log('[place] could not resolve short URL. Final URL:', res.url);
  console.log('[place] body start:', body.slice(0, 300).replace(/\s+/g, ' '));
  return null;
}

// Map Google Places type identifiers to human-readable labels.
const GENERIC_TYPES = new Set([
  'point_of_interest', 'establishment', 'food', 'health', 'finance',
  'place_of_worship', 'general_contractor', 'local_government_office',
  'premise', 'street_address', 'route',
]);
const TYPE_LABELS = {
  restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', bakery: 'Bakery',
  night_club: 'Night Club', meal_takeaway: 'Takeaway',
  museum: 'Museum', tourist_attraction: 'Tourist Attraction',
  art_gallery: 'Art Gallery', amusement_park: 'Amusement Park',
  aquarium: 'Aquarium', zoo: 'Zoo',
  park: 'Park', natural_feature: 'Nature',
  shopping_mall: 'Shopping Mall', store: 'Store',
  book_store: 'Book Store', clothing_store: 'Clothing Store',
  electronics_store: 'Electronics Store', grocery_or_supermarket: 'Grocery Store',
  supermarket: 'Supermarket', convenience_store: 'Convenience Store',
  lodging: 'Hotel', hotel: 'Hotel', motel: 'Motel',
  gym: 'Gym', spa: 'Spa', beauty_salon: 'Salon', pharmacy: 'Pharmacy',
  hospital: 'Hospital', library: 'Library', movie_theater: 'Movie Theater',
  airport: 'Airport', train_station: 'Train Station',
  subway_station: 'Subway Station', bus_station: 'Bus Station',
  transit_station: 'Transit Station', gas_station: 'Gas Station',
};

function getTypeLabel(types = []) {
  for (const t of types) {
    if (!GENERIC_TYPES.has(t) && TYPE_LABELS[t]) return TYPE_LABELS[t];
  }
  // Fall back to formatting the first non-generic type
  for (const t of types) {
    if (!GENERIC_TYPES.has(t)) return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return null;
}

// GET /api/resolve-url?url=<google-maps-url>
// Expands a short Maps URL (maps.app.goo.gl) to a full one and extracts lat/lng.
app.get('/api/resolve-url', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const full = await resolveGoogleMapsUrl(url);
    if (!full) return res.status(404).json({ error: 'Could not resolve URL' });
    // Extract !3d<lat>!4d<lng> or @<lat>,<lng>
    const d3All = [...full.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)];
    const d3    = d3All.length ? d3All[d3All.length - 1] : null;
    const at    = full.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match = d3 || at;
    if (!match) return res.status(404).json({ error: 'No coordinates in resolved URL', resolvedUrl: full });
    res.json({ lat: parseFloat(match[1]), lng: parseFloat(match[2]), resolvedUrl: full });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/geocode?address=<free text>
// Returns { lat, lng, formattedAddress } using Google Geocoding API.
app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Missing address' });

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not set' });

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
    const data = await (await fetch(url)).json();
    console.log(`[geocode] "${address}" → status: ${data.status}, results: ${data.results?.length ?? 0}`);
    if (data.status !== 'OK' || !data.results?.length) {
      return res.status(404).json({ error: `No results (${data.status})` });
    }
    const r = data.results[0];
    res.json({
      lat:              r.geometry.location.lat,
      lng:              r.geometry.location.lng,
      formattedAddress: r.formatted_address,
    });
  } catch (err) {
    console.error('[geocode] error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/place?url=<google-maps-url>
// Resolves a Google Maps URL → place details (hours, rating, price level).
// Uses Places API (Legacy): findplacefromtext + place details.
app.get('/api/place', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not set — add it to trip/server/.env' });

  try {
    // 1. Resolve the URL (handles short links and bot-redirect pages)
    const fullUrl = await resolveGoogleMapsUrl(url);

    if (!fullUrl) {
      return res.status(400).json({
        error: "Couldn't expand this short link — Google's share links use a JavaScript redirect that can't be followed server-side. Please paste the full Google Maps URL instead: open the place in Google Maps on desktop, copy the URL from the address bar, and paste that.",
      });
    }

    console.log('[place] resolved:', fullUrl);

    // 2. Extract place name and coordinates
    const nameMatch  = fullUrl.match(/\/maps\/place\/([^/@?#]+)/);
    // !3d / !4d appear multiple times; the LAST occurrence is the specific place, not the map center.
    const d3All   = [...fullUrl.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)];
    const d3Match = d3All.length ? d3All[d3All.length - 1] : null;
    const atMatch    = fullUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const coordMatch = d3Match || atMatch;

    if (!nameMatch) {
      return res.status(400).json({
        error: 'Could not find a place name in the URL. Try pasting the full Google Maps link.',
        resolved: fullUrl,
      });
    }

    const placeName = decodeURIComponent(nameMatch[1].replace(/\+/g, ' '));
    const lat       = coordMatch?.[1];
    const lng       = coordMatch?.[2];
    console.log('[place] query:', placeName, { lat, lng });

    // 3. Find the place_id via text search
    const locationBias = lat && lng ? `&locationbias=point:${lat},${lng}` : '';
    const findUrl =
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${encodeURIComponent(placeName)}` +
      `&inputtype=textquery` +
      `&fields=place_id,name` +
      `${locationBias}` +
      `&key=${key}`;

    const findData = await (await fetch(findUrl)).json();
    console.log('[place] findplacefromtext status:', findData.status, '| candidates:', findData.candidates?.length ?? 0);

    if (findData.status !== 'OK' || !findData.candidates?.length) {
      return res.status(404).json({
        error: `Place not found (${findData.status})`,
        query: placeName,
        apiMessage: findData.error_message,
      });
    }

    const placeId = findData.candidates[0].place_id;
    console.log('[place] place_id:', placeId);

    // 4. Fetch place details
    const detailUrl =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${placeId}` +
      `&fields=name,opening_hours,rating,price_level,website,formatted_address,types,geometry` +
      `&language=en` +
      `&key=${key}`;

    const detail = await (await fetch(detailUrl)).json();
    console.log('[place] details status:', detail.status);

    if (detail.status !== 'OK') {
      return res.status(502).json({
        error: `Place details failed (${detail.status})`,
        apiMessage: detail.error_message,
      });
    }

    const r = detail.result;
    res.json({
      name:       r.name,
      placeId,
      address:    r.formatted_address,
      lat:        r.geometry?.location?.lat ?? null,
      lng:        r.geometry?.location?.lng ?? null,
      typeLabel:  getTypeLabel(r.types),
      rating:     r.rating      ?? null,
      priceLevel: r.price_level ?? null,
      website:    r.website     ?? null,
      hours: r.opening_hours ? {
        weekdayText: r.opening_hours.weekday_text ?? [],
        periods:     r.opening_hours.periods      ?? [],
      } : null,
    });
  } catch (err) {
    console.error('[place] unexpected error:', err);
    res.status(502).json({ error: err.message });
  }
});

// Convert AeroDataBox local time string "2026-04-22 15:00-05:00" → ISO 8601
// Handles formats: "2026-04-22 15:00-05:00", "2026-04-22 15:00Z", "2026-04-22 15:00"
function aeroToIso(str) {
  if (!str) return null;
  return str.trim().replace(' ', 'T');
}

// Pick the best available local time string from an AeroDataBox endpoint object.
// New API format: times are nested under scheduledTime / revisedTime / predictedTime
// Old format (date-specific endpoint): flat scheduledTimeLocal / revisedTimeLocal
function aeroTime(endpoint) {
  return endpoint?.scheduledTime?.local
      ?? endpoint?.scheduledTimeLocal
      ?? endpoint?.revisedTime?.local
      ?? endpoint?.predictedTime?.local
      ?? endpoint?.revisedTimeLocal
      ?? null;
}

// GET /api/flight?number=VB101&date=2026-04-22
// Returns { flights: [{ number, airline, departure, arrival }] }
app.get('/api/flight', async (req, res) => {
  const { number, date } = req.query;
  if (!number || !date) return res.status(400).json({ error: 'Missing number or date' });

  const key = process.env.AERODATABOX_RAPIDAPI_KEY;
  if (!key) return res.status(500).json({ error: 'AERODATABOX_RAPIDAPI_KEY not set — add it to trip/server/.env' });

  const flightNum = number.replace(/\s+/g, '').toUpperCase();
  // Use the "nearest day" endpoint which returns full time data (scheduledTime.local).
  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNum)}` +
              `?withAircraftImage=false&withLocation=false&withFlightPlan=false`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('[flight] API error:', upstream.status, text.slice(0, 200));
      return res.status(upstream.status).json({ error: `Flight API error (${upstream.status})`, detail: text.slice(0, 200) });
    }

    const data = await upstream.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'No flights found for that number' });
    }

    // Filter to results that match the requested date (by departure or arrival local date).
    // If none match exactly, return all results so the user can pick.
    const matchDate = (f) => {
      const depLocal = aeroTime(f.departure);
      const arrLocal = aeroTime(f.arrival);
      return (depLocal && depLocal.startsWith(date)) || (arrLocal && arrLocal.startsWith(date));
    };
    const filtered = data.filter(matchDate);
    const results  = filtered.length > 0 ? filtered : data;

    const flights = results.map(f => {
      const depTime = aeroToIso(aeroTime(f.departure));
      const arrTime = aeroToIso(aeroTime(f.arrival));
      console.log(`[flight]   leg: ${f.departure?.airport?.iata} ${depTime} → ${f.arrival?.airport?.iata} ${arrTime}`);
      return {
        number:  f.number  || flightNum,
        airline: f.airline?.name || 'Unknown Airline',
        departure: {
          iata: f.departure?.airport?.iata  ?? null,
          name: f.departure?.airport?.municipalityName || f.departure?.airport?.name || null,
          time: depTime,
          tz:   f.departure?.airport?.timeZone ?? null,
          lat:  f.departure?.airport?.location?.lat ?? null,
          lng:  f.departure?.airport?.location?.lon ?? null,
        },
        arrival: {
          iata: f.arrival?.airport?.iata  ?? null,
          name: f.arrival?.airport?.municipalityName || f.arrival?.airport?.name || null,
          time: arrTime,
          tz:   f.arrival?.airport?.timeZone ?? null,
          lat:  f.arrival?.airport?.location?.lat ?? null,
          lng:  f.arrival?.airport?.location?.lon ?? null,
        },
      };
    });

    console.log(`[flight] ${flightNum} ${date}: ${flights.length} result(s)`);
    res.json({ flights });
  } catch (err) {
    console.error('[flight] error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Trip state persistence (Supabase) ────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function requirePassword(req, res, next) {
  const tripId = req.headers['x-trip-id'];
  const pw     = req.headers['x-trip-password'];
  if (!tripId) return res.status(400).json({ error: 'Missing X-Trip-Id header' });

  const sb = getSupabase();
  if (!sb) {
    // Dev fallback: no Supabase configured — accept any request
    req.tripId = tripId;
    return next();
  }

  const { data: trip } = await sb
    .from('trips')
    .select('password')
    .eq('id', tripId)
    .single();

  if (!trip || trip.password !== pw) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  req.tripId = tripId;
  next();
}

// GET /api/trips — public list of trip names
app.get('/api/trips', async (req, res) => {
  const sb = getSupabase();
  if (!sb) return res.json({ trips: [] });
  const { data, error } = await sb
    .from('trips')
    .select('id, name')
    .order('created_at');
  if (error) return res.status(502).json({ error: error.message });
  res.json({ trips: data || [] });
});

// POST /api/trips — create a new trip
app.post('/api/trips', async (req, res) => {
  const { name, password } = req.body;
  if (!name?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'name and password are required' });
  }
  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });
  const { data, error } = await sb
    .from('trips')
    .insert({ name: name.trim(), password: password.trim() })
    .select('id')
    .single();
  if (error) return res.status(502).json({ error: error.message });
  res.json({ id: data.id });
});

// GET /api/state — fetch persisted trip state
app.get('/api/state', requirePassword, async (req, res) => {
  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { data, error } = await sb
    .from('trip_state')
    .select('state, updated_at')
    .eq('id', req.tripId)
    .maybeSingle();

  if (error) return res.status(502).json({ error: error.message });
  res.json({ state: data?.state ?? null, updatedAt: data?.updated_at ?? null });
});

// PUT /api/state — save trip state
app.put('/api/state', requirePassword, async (req, res) => {
  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Database not configured' });

  const { state } = req.body;
  if (!state) return res.status(400).json({ error: 'Missing state' });

  const { data, error } = await sb
    .from('trip_state')
    .upsert({ id: req.tripId, state, updated_at: new Date().toISOString() })
    .select('updated_at')
    .single();

  if (error) return res.status(502).json({ error: error.message });
  res.json({ ok: true, updatedAt: data.updated_at });
});

// Export for Vercel serverless; also listen directly when run via `node server.js`
module.exports = app;
if (require.main === module) {
  app.listen(PORT, () =>
    console.log(`Trip API server listening on http://localhost:${PORT}`)
  );
}
