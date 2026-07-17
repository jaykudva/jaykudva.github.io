// ═══════════════════════════════════════════════════════════════════════════
//  BJAY BCRAWL — route data
//  Everything on the page renders from this file. Edit stops, times, notes.
// ═══════════════════════════════════════════════════════════════════════════

const CRAWL_CONFIG = {
  // Fallback departure time, used only if dispatch is offline or hasn't set one.
  // The real value is set from the admin page ("Departure time") and lives in
  // the database. ISO string WITH timezone offset (-04:00 = NYC summer).
  serviceBegins: "2026-07-18T18:00:00-04:00",
  destination: "Rooftop Terminal",
};

// Each stop:
//   name          station name shown on the signboard
//   neighborhood  small caps under the name
//   time          scheduled arrival, display string
//   address       street address (omit or leave "" if unknown yet)
//   mapsUrl       Google Maps link for the Directions button
//   note          conductor's note — your personal pitch for the place
//   mustOrder     recommended fare (optional)
//   transfers     emoji rendered as transfer bullets (optional)
//   terminus      true on the last stop — gets rooftop styling
//   secretAddress true = address hidden until the train is en route to it
const CRAWL_STOPS = [
  {
    name: "SAUCED",
    neighborhood: "East Village",
    time: "6:00 PM",
    address: "47 2nd Ave",
    mapsUrl: "https://maps.app.goo.gl/rT6iUs7modqnJUU87",
    note: "we gotta have wine....",
    mustOrder: "light french red 😋",
    transfers: ["🍷"],
  },
  {
    name: "Conor's Goat",
    neighborhood: "East Village",
    time: "7:45 PM",
    address: "23 Avenue A",
    mapsUrl: "https://maps.app.goo.gl/dYdsa4gSr1bwtiBV7",
    note: "cheeky lil pint for the road",
    transfers: ["🍺"],
  },
  {
    name: "Beto's",
    neighborhood: "Lower East Side",
    time: "8:30 PM",
    address: "69 Clinton St",
    mapsUrl: "https://maps.app.goo.gl/JeGd2eJafTHi7fMB6",
    note: "guisado in nyc!",
    mustOrder: "pollo en mole verde!",
    transfers: ["🌮"],
  },
  {
    name: "Lai Rai",
    neighborhood: "Chinatown",
    time: "9:30 PM",
    address: "76 Forsyth St",
    mapsUrl: "https://maps.app.goo.gl/vXQBpanzqob6CHuD9",
    note: "ice cream stop at a wine bar... who'd a thunk",
    mustOrder: "BANANA LEAF!",
    transfers: ["🍨"],
  },
  {
    name: "TIME AGAIN",
    neighborhood: "Chinatown",
    time: "10:15 PM",
    address: "76 Forsyth St",
    mapsUrl: "https://maps.app.goo.gl/PWipAkRYbufC4tAa8",
    note: "lowkey highkey play by ear situation...",
    transfers: ["🍺"],
  },
 {
    name: "Cellar 36",
    neighborhood: "Two Bridges",
    time: "11:00 PM",
    address: "36 Market St",
    mapsUrl: "https://maps.app.goo.gl/TNwbmk5CGpTHC3KZ9",
    note: "WINE.",
    transfers: ["🍷"],
    terminus: true,
  }
];
