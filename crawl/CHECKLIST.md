# Seattle Food & Bar Crawl — Implementation Checklist

## ✅ Phase 1: Complete (Ready to Deploy)

- [x] `index.html` — Main page with theme toggle, dark/light mode, responsive design
- [x] `spots.js` — Data structure with placeholder entries
- [x] `map.js` — Pre-built Google Maps logic (waiting for Phase 2)
- [x] Vertical connector line between stops (CSS)
- [x] Numbered badges matching site colors
- [x] Type tags (bar, restaurant, cafe, etc)
- [x] "Try" callout styling
- [x] Mobile responsive (480px breakpoint)
- [x] OG meta tags skeleton (Phase 3 ready)
- [x] Documentation (QUICK_START, README, IMPLEMENTATION_SUMMARY)

### Phase 1 Deployment
- [ ] Fill `spots.js` with real stops
- [ ] Test locally: `python3 -m http.server 8000`
- [ ] Verify theme toggle works
- [ ] Verify layout on mobile
- [ ] Commit to `jaykudva.github.io`: `git add crawl/ && git commit -m "Add Seattle food & bar crawl" && git push`
- [ ] Verify live at `https://jaykudva.github.io/crawl/`

---

## 📋 Phase 2: Ready (Blocked on Google Maps Setup)

**Pre-requisite:** Google Maps API key

### Google Maps Setup
- [ ] Create Google Cloud project
- [ ] Enable **Maps JavaScript API**
- [ ] Enable **Directions API** (for walking route)
- [ ] Generate API key
- [ ] Restrict to domain: `https://jaykudva.github.io/crawl/*` and `http://localhost:*`
- [ ] Restrict to API: **Maps JavaScript API** only
- [ ] Copy API key

### Directions API (One-Time)
- [ ] Deploy Phase 1 with your stops
- [ ] Open `https://jaykudva.github.io/crawl/` in browser
- [ ] Run directions console command (see QUICK_START.md)
- [ ] Copy polyline output
- [ ] Paste into `spots.js` as `CRAWL_ROUTE_POLYLINE`

### Phase 2 Activation
- [ ] In `index.html`, comment out Phase 1 container
- [ ] In `index.html`, uncomment Phase 2 wrapper + scripts
- [ ] Replace `YOUR_API_KEY_HERE` with actual API key
- [ ] Verify map renders locally
- [ ] Test bidirectional clicks (marker → list, list → marker)
- [ ] Test theme toggle updates map
- [ ] Commit & push
- [ ] Verify live at `https://jaykudva.github.io/crawl/`

### Phase 2 Features (Pre-built)
- [x] Interactive map with dark theme
- [x] Numbered SVG markers
- [x] Walking route polyline
- [x] Click marker → scroll list
- [x] Click list item → pan map
- [x] Auto-zoom to fit markers
- [x] Theme sync with page toggle

---

## 🎨 Phase 3: Optional (Blocked on Image)

### Setup
- [ ] Create `og-image.png` (1200×630px)
  - Option 1: Screenshot of map with all pins
  - Option 2: Designed card
  - Option 3: Your preferred visual
- [ ] Save as `crawl/og-image.png`
- [ ] Update `index.html` OG meta tags:
  ```html
  <meta property="og:image" content="https://jaykudva.github.io/crawl/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  ```
- [ ] Test link preview at https://www.opengraph.xyz
- [ ] Commit & push

---

## 📝 Data Entry Checklist

For each stop in `spots.js`:

- [ ] **name** — Official spot name
- [ ] **type** — One of: `bar`, `restaurant`, `deli`, `cafe`, `pub`
- [ ] **neighborhood** — Seattle area (Capitol Hill, Ballard, Pike Place, etc)
- [ ] **coords** — From Google Maps info panel:
  - [ ] Latitude (positive, e.g., 47.6205)
  - [ ] Longitude (negative for Seattle, e.g., -122.3212)
  - Format: `{ lat: 47.6205, lng: -122.3212 }`
- [ ] **note** — Personal flavor text (1-2 sentences in Jay's voice)
- [ ] **mustTry** — One signature item (optional but recommended)
- [ ] **Stop order** — Logical geographic flow (minimize backtracking)

---

## 🧪 Testing Checklist

### Phase 1 Testing
- [ ] Page renders with theme toggle visible
- [ ] Dark mode ON by default
- [ ] Theme toggle switches dark ↔ light
- [ ] All spots render as numbered cards
- [ ] Connector line visible between spots
- [ ] Type tags have green background
- [ ] MustTry items show coral callout
- [ ] Mobile layout (≤480px) stacks properly
- [ ] Tablet layout (480–1024px) handles width
- [ ] Desktop layout (≥1024px) shows full width

### Phase 2 Testing (after API key)
- [ ] Map renders (no white space)
- [ ] Markers appear with correct numbers
- [ ] Polyline draws from start to end
- [ ] Click marker → list scrolls to item + blue highlight
- [ ] Click list item → map pans to marker
- [ ] Theme toggle updates map colors
- [ ] Map auto-centered and auto-zoomed correctly
- [ ] No console errors for API key or CORS

### Phase 3 Testing (after OG image)
- [ ] https://www.opengraph.xyz shows title + description
- [ ] https://www.opengraph.xyz shows og-image preview
- [ ] Image displays at 1200×630 proportion

---

## 🚀 Deployment Steps

### Phase 1
```bash
cd /path/to/jaykudva.github.io
git add crawl/
git commit -m "Add Seattle food & bar crawl page"
git push
# Live at: https://jaykudva.github.io/crawl/
```

### Phase 2
```bash
git add crawl/index.html crawl/spots.js
git commit -m "Add interactive map to crawl page"
git push
```

### Phase 3
```bash
git add crawl/og-image.png crawl/index.html
git commit -m "Add shareable link preview to crawl page"
git push
```

---

## 📚 Reference Files

| File | Purpose |
|------|---------|
| `QUICK_START.md` | Copy-paste commands and code snippets |
| `README.md` | Detailed setup guide + troubleshooting |
| `IMPLEMENTATION_SUMMARY.md` | Full project overview |
| `CHECKLIST.md` | This file — step-by-step tasks |

---

## ❓ Troubleshooting Links

- **HTML issues?** → Open in browser, check console for JS errors
- **Map not loading?** → Check API key + domain restrictions in Cloud Console
- **Coordinates wrong?** → Re-verify from Google Maps info panel
- **Responsive layout broken?** → Check viewport meta tag + CSS breakpoints

---

**Last Updated:** Phase 1 Complete (2026-02-04)
**Status:** Ready for Phase 1 deployment + Phase 2 standby
