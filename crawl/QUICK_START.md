# Quick Start — Seattle Food & Bar Crawl

## Phase 1: Live Right Now ✅

### 1. Fill in `spots.js`

Replace the placeholder data with your crawl stops:

```javascript
const CRAWL_SPOTS = [
  {
    name: "Stateside Cocktails",
    type: "bar",
    neighborhood: "Capitol Hill",
    coords: { lat: 47.6205, lng: -122.3212 },
    note: "cozy neighborhood spot with killer Old Fashioneds",
    mustTry: "Old Fashioned"
  },
  {
    name: "Zikla Mediterranean",
    type: "restaurant",
    neighborhood: "Ballard",
    coords: { lat: 47.6680, lng: -122.3875 },
    note: "fresh seafood, best halibut in the city",
    mustTry: "Halibut"
  },
  // ... more stops
];
```

**Getting coordinates:**
1. Search location on Google Maps
2. Click the info panel
3. Coordinates appear at the top
4. Format: `{ lat: 47.6062, lng: -122.3321 }`

### 2. Test Locally

```bash
cd /path/to/jaykudva.github.io/crawl/
python3 -m http.server 8000
# Open http://localhost:8000/
```

### 3. Deploy

```bash
cd /path/to/jaykudva.github.io/
git add crawl/
git commit -m "Add Seattle food & bar crawl"
git push
```

**Live at:** `https://jaykudva.github.io/crawl/`

---

## Phase 2: Add Interactive Map (Optional)

### 1. Get Google Maps API Key

- Go to https://console.cloud.google.com
- Create project → Enable Maps JS API + Directions API
- Create API Key → Restrict to `jaykudva.github.io` + Maps JS API only

### 2. Get Walking Route

In browser console at the crawl page:

```javascript
const waypoints = CRAWL_SPOTS.map(s => ({ location: { lat: s.coords.lat, lng: s.coords.lng } }));
const directionsService = new google.maps.DirectionsService();
directionsService.route({
  origin: waypoints[0].location,
  destination: waypoints[waypoints.length - 1].location,
  waypoints: waypoints.slice(1, -1),
  travelMode: google.maps.TravelMode.WALKING
}, (result, status) => {
  if (status === 'OK') console.log(result.routes[0].overview_polyline.points);
});
```

Copy the output → paste into `spots.js`:

```javascript
const CRAWL_ROUTE_POLYLINE = "paste_here";
```

### 3. Activate Phase 2 in `index.html`

Find and swap these sections:

**Comment out:**
```html
<!-- <div class="crawl-container" id="phase1-container"> -->
```

**Uncomment:**
```html
<div class="crawl-wrapper">
  <div class="crawl-map-section">
    <div id="crawl-map"></div>
  </div>
  ...
</div>
```

**Replace `YOUR_API_KEY_HERE` in:**
```html
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY_HERE&libraries=geometry"></script>
<script src="map.js"></script>
```

### 4. Deploy

```bash
git add crawl/
git commit -m "Add interactive map to crawl"
git push
```

---

## Phase 3: Link Preview Image (Optional)

Create `crawl/og-image.png` (1200×630px) and add to `index.html`:

```html
<meta property="og:image" content="https://jaykudva.github.io/crawl/og-image.png">
```

Test at: https://www.opengraph.xyz

---

## File Reference

| File | Purpose | When to Edit |
|------|---------|-------------|
| `spots.js` | Crawl stops (name, type, coords, notes) | Always (your data) |
| `index.html` | Layout + styles + theme toggle | Phase 2+ (activate map) |
| `map.js` | Google Maps logic | Never (pre-built for Phase 2) |
| `README.md` | Detailed setup guide | Reference only |

---

## Spot Types

- `bar` — cocktails, beer, wine
- `restaurant` — food-focused
- `deli` — sandwiches, quick bites
- `cafe` — coffee, casual
- `pub` — neighborhood hangout

---

## Colors

- Blue `#6CB2D1` — badges, accents
- Green `#2d6a4f` — type tags
- Coral `#ff5f42` — mustTry highlights

---

## Questions?

See `README.md` for troubleshooting.
