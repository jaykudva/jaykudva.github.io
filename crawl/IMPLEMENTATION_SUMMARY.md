# Seattle Food & Bar Crawl — Implementation Summary

## ✅ Complete: Phase 1

The ordered route list page is **fully implemented and deployable**.

### What Was Built

```
crawl/
├── index.html          (339 lines) - Main page with HTML + CSS + JS
├── spots.js            (28 lines)  - Placeholder data (user fills in real stops)
├── map.js              (135 lines) - Google Maps logic (ready for Phase 2)
├── README.md           (180 lines) - Setup & usage guide
└── IMPLEMENTATION_SUMMARY.md (this file)
```

### Phase 1 Features

✅ **Ordered list view** - Numbered stops (1, 2, 3...)
✅ **Vertical connector line** - CSS pseudo-element between stops
✅ **Dark/light theme toggle** - Button in header (matches main site)
✅ **Responsive design** - Mobile, tablet, desktop
✅ **Color scheme** - Blue badges, green type tags, coral mustTry callouts
✅ **Typography** - Inter font, matching main site
✅ **OG meta tags** - Ready for Phase 3 image

### How to Use Phase 1 Right Now

1. **Edit `spots.js`** with your stops:
   ```javascript
   const CRAWL_SPOTS = [
     {
       name: "Spot Name",
       type: "bar|restaurant|deli|cafe|pub",
       neighborhood: "Capitol Hill",
       coords: { lat: 47.6062, lng: -122.3321 },
       note: "personal note in jay's voice",
       mustTry: "the thing to order" // optional
     }
   ];
   ```

2. **Get coordinates** from Google Maps:
   - Search location → info panel shows coords

3. **Test locally:**
   ```bash
   python3 -m http.server 8000
   open http://localhost:8000/crawl/
   ```

4. **Deploy** - Push to `jaykudva.github.io` repo:
   ```bash
   git add crawl/
   git commit -m "Add Seattle food & bar crawl page"
   git push
   ```
   Available at: `https://jaykudva.github.io/crawl/`

---

## 📋 Phase 2: Interactive Map (Roadmap)

Ready to implement once you have a Google Maps API key.

### Files Already Prepared

- **`map.js`** (135 lines) - Complete Google Maps initialization, markers, polyline, theme switching, click events
- **`index.html`** - Includes commented Phase 2 sections (swap layout + uncomment scripts)

### Phase 2 Setup Checklist

- [ ] Create Google Cloud project: https://console.cloud.google.com
- [ ] Enable Maps JavaScript API
- [ ] Enable Directions API
- [ ] Generate API key (restrict to domain + Maps JS API only)
- [ ] Get walking route polyline via Directions API
- [ ] Paste polyline into `spots.js`
- [ ] Update API key in `index.html` Google Maps script tag
- [ ] Uncomment Phase 2 layout in `index.html`
- [ ] Uncomment `map.js` script tag
- [ ] Deploy

### Phase 2 Features (Pre-built)

✅ **Interactive map** - Renders with dark/light theme support
✅ **Numbered pin markers** - SVG icons matching list numbers
✅ **Walking route polyline** - Drawn from Directions API
✅ **Bidirectional clicks** - Pin → scroll list, list → pan map
✅ **Auto-zoom** - Fits all markers in viewport
✅ **Theme sync** - Map colors change with dark/light toggle

### Phase 2 Directions API (One-Time Setup)

After pasting your stops and API key:

```javascript
// Run in browser console on the crawl page to get the polyline:
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
    // Copy output → paste into spots.js as CRAWL_ROUTE_POLYLINE
  }
});
```

---

## 🎨 Phase 3: Shareable Polish (Optional)

OG image + meta tags for link previews.

### Phase 3 Checklist

- [ ] Create `crawl/og-image.png` (1200×630px)
- [ ] Add og:image meta tags to `index.html`
- [ ] Test with https://www.opengraph.xyz

---

## Design Details

### Colors (from main site)
- **Blue**: `#6CB2D1` - Number badges, accents, button states
- **Green**: `#2d6a4f` - Type tags (bar, restaurant, etc)
- **Coral**: `#ff5f42` - MustTry callouts

### Fonts
- **Family**: Inter (Google Fonts, wght 300 & 600)
- **Sizes**: Heading 1.5rem, content 0.95–1.1rem, metadata 0.85rem

### Spacing
- **Card gap**: 1.5rem (mobile: 1.25rem)
- **Padding**: 1.5rem (mobile: 1.25rem)
- **Border radius**: 16px (cards & map)

### Responsive Breakpoints
- Mobile: ≤480px (1-column, smaller text)
- Tablet: 481–1023px (1-column with larger map)
- Desktop: ≥1024px (side-by-side map + list)

---

## Cost

**$0** — Google Maps at this traffic level.

- Maps JS API: 10,000 free loads/month (vs ~200–500 crawl loads)
- Directions API: Polyline fetched once during setup, hardcoded in `spots.js` (zero runtime calls)
- Requires billing enabled (credit card on file) but you won't be charged

---

## Next Steps

1. **Now**: Populate `spots.js` with your crawl stops
2. **Soon**: Deploy Phase 1 to GitHub Pages
3. **Later**: Set up Google Maps for Phase 2 (only if you want the interactive map)
4. **Optional**: Add OG image for Phase 3 (link preview sharing)

---

## Questions?

See `README.md` for detailed setup instructions.
