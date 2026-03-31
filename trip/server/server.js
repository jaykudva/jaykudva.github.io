require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3001;

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
app.get('/api/route', async (req, res) => {
  const { fromLat, fromLng, toLat, toLng } = req.query;

  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ error: 'Missing coordinates' });
  }

  const key = process.env.GRAPHHOPPER_API_KEY;
  if (!key) return res.status(500).json({ error: 'GRAPHHOPPER_API_KEY not set' });

  const url =
    `https://graphhopper.com/api/1/route` +
    `?point=${fromLat},${fromLng}` +
    `&point=${toLat},${toLng}` +
    `&profile=car` +
    `&locale=en` +
    `&key=${key}`;

  try {
    const upstream = await fetch(url);
    const data     = await upstream.json();

    if (!data.paths?.length) {
      return res.status(502).json({ error: 'No route found', detail: data.message });
    }

    const path     = data.paths[0];
    const distKm   = path.distance / 1000;
    const driveMin = Math.round(path.time / 60000);
    const walkMin  = Math.round((distKm / 4.5) * 60); // 4.5 km/h walking pace

    res.json({ distKm, driveMin, walkMin });
  } catch (err) {
    console.error('[route] upstream error:', err.message);
    res.status(502).json({ error: 'Routing request failed' });
  }
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

app.listen(PORT, () =>
  console.log(`Trip API server listening on http://localhost:${PORT}`)
);
