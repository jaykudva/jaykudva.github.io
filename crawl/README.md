# Seattle Food & Bar Crawl

A shareable, interactive food and bar crawl page for Seattle. Pure static HTML with no build tools or backend.

## Current Status: Phase 1 ✅

**Phase 1 is complete and deployable.** The page shows a numbered list of stops with a connecting line, dark/light theme toggle, and responsive design.

### Files

- `index.html` - The main page (HTML + inline CSS + JS)
- `spots.js` - Crawl data (CRAWL_SPOTS array)
- `map.js` - Google Maps logic (ready for Phase 2)

---

## Phase 1: Ordered Route List (Live)

A fully functional list view with no map API required.

### Quick Start

1. **Edit `spots.js`** with your stops:

```javascript
const CRAWL_SPOTS = [
  {
    name: "Spot Name",
    type: "bar",                    // bar | restaurant | deli | cafe | pub
    neighborhood: "Capitol Hill",
    coords: { lat: 47.6062, lng: -122.3321 },
    note: "your personal note",
    mustTry: "signature drink"      // optional
  },
  // ... more stops in order
];
```

2. **Get coordinates** from Google Maps:
   - Search the location
   - Click the info panel on the right
   - Coordinates are shown at the top

3. **Test locally:**
   ```bash
   python -m http.server 8000
   # then open http://localhost:8000/crawl/
   ```

4. **Deploy** to GitHub Pages (no changes needed to `jaykudva.github.io`).

---

## Phase 2: Interactive Map (Ready)

Map + list side-by-side with bidirectional interaction. **Google Maps API key required.**

### Setup Before Phase 2

1. **Create Google Cloud Project:**
   - Go to https://console.cloud.google.com
   - Create a new project
   - Enable **Maps JavaScript API**
   - Enable **Routes API** (for Directions)

2. **Generate API Key:**
   - In the Cloud Console, go to **Credentials**
   - Create an **API Key**
   - Click the key to open settings
   - Under **Application restrictions**, select **HTTP referrers (web sites)**
   - Add: `https://jaykudva.github.io/crawl/*` and `http://localhost:*`
   - Under **API restrictions**, select **Maps JavaScript API** only
   - Copy the key

3. **Get the walking route polyline:**
   - In browser console on the crawl page, run:
   ```javascript
   const waypoints = CRAWL_SPOTS.map(s => ({ location: { lat: s.coords.lat, lng: s.coords.lng } }));
   const directionsService = new google.maps.DirectionsService();
   directionsService.route({
     origin: waypoints[0].location,
     destination: waypoints[waypoints.length - 1].location,
     waypoints: waypoints.slice(1, -1),
     travelMode: google.maps.TravelMode.WALKING
   }, (result, status) => {
     if (status === 'OK') {
       console.log(result.routes[0].overview_polyline.points);
     }
   });
   ```
   - Copy the output string and paste into `spots.js`:
   ```javascript
   const CRAWL_ROUTE_POLYLINE = "paste_string_here";
   ```

4. **Activate Phase 2:**
   - In `index.html`, swap:
     - Comment out: `<div class="crawl-container" id="phase1-container">`
     - Uncomment: `<div class="crawl-wrapper">` section
     - Uncomment: Google Maps script tags with your API key
     - Uncomment: `<script src="map.js"></script>`

5. **Features:**
   - Click a marker → scrolls to the list item
   - Click a list item → pans map to that marker
   - Dark/light theme toggle affects map colors
   - Map auto-centers and auto-zooms to fit all pins
   - Walking route drawn as a polyline

---

## Phase 3: Shareable Polish (Optional)

OG meta tags for link previews (no logic changes).

### Setup

1. **Create `crawl/og-image.png`:**
   - 1200×630px image
   - Screenshot of the map with pins, or a designed card
   - Save as PNG in the `crawl/` directory

2. **Update OG meta tags in `index.html`:**
   ```html
   <meta property="og:image" content="https://jaykudva.github.io/crawl/og-image.png">
   <meta property="og:image:width" content="1200">
   <meta property="og:image:height" content="630">
   ```

3. **Verify:**
   - Use [opengraph.xyz](https://www.opengraph.xyz) to check link preview

---

## Colors (from main site)

- **Blue**: `#6CB2D1` (number badges, accents)
- **Green**: `#2d6a4f` (type tags)
- **Coral**: `#ff5f42` (mustTry callouts)

---

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Dark mode default, with light mode toggle
- Responsive: mobile, tablet, desktop

---

## Cost

**Free.** Google Maps Platform:
- Maps JS API: 10,000 free loads/month (way more than needed)
- Directions API: Route polyline fetched once during setup, hardcoded in `spots.js`
- No runtime charges at this traffic level
- Requires billing enabled on Google Cloud (credit card on file) but won't be charged

---

## Troubleshooting

**Map doesn't load:**
- Check API key is correct in `<script src="...?key=..."`
- Verify API key restrictions allow `jaykudva.github.io` domain
- Check browser console for errors

**Coordinates wrong:**
- Get them from Google Maps info panel (top-right of search result)
- Format: `{ lat: 47.6062, lng: -122.3321 }` (careful with negative longitude for Seattle)

**Route line doesn't appear:**
- Make sure Directions API is enabled in Cloud Console
- Verify `CRAWL_ROUTE_POLYLINE` is not empty in `spots.js`

---

## Questions?

Check the implementation plan or open an issue on GitHub.
