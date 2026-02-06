// Google Maps initialization and logic for the crawl page
// This file is loaded in Phase 2 when the map <div> is added

let map;
let markers = [];
let routePolyline;
let markerElements = [];
const markerSizes = {};
let currentHighlightedIndex = null;

// Standard Google Maps light (daytime) theme with POIs hidden
const darkMapStyles = [
  { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
  { "featureType": "poi.business", "stylers": [{ "visibility": "off" }] }
];

const lightMapStyles = [
  { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
  { "featureType": "poi.business", "stylers": [{ "visibility": "off" }] }
];

// SVG data URI for numbered marker icons
function getMarkerIconSvg(number) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
      <circle cx="24" cy="20" r="16" fill="#a89968" stroke="#fff" stroke-width="2"/>
      <text x="24" y="27" font-size="18" font-weight="300" text-anchor="middle" fill="#2a2620" font-family="'Instrument Serif', serif">${number}</text>
      <polygon points="24,40 16,28 32,28" fill="#a89968"/>
    </svg>
  `;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function initMap() {
  if (!CRAWL_SPOTS || CRAWL_SPOTS.length === 0) {
    console.error('No crawl spots found');
    return;
  }

  // Calculate bounds from all spots
  const bounds = new google.maps.LatLngBounds();
  CRAWL_SPOTS.forEach(spot => {
    bounds.extend({ lat: spot.coords.lat, lng: spot.coords.lng });
  });

  const mapOptions = {
    zoom: 14,
    center: bounds.getCenter(),
    scrollwheel: true,
    styles: darkMapStyles,
    mapTypeControl: false,
    fullscreenControl: true,
    streetViewControl: false
  };

  const mapElement = document.getElementById('crawl-map');
  map = new google.maps.Map(mapElement, mapOptions);

  // Add markers for each spot
  CRAWL_SPOTS.forEach((spot, index) => {
    const marker = new google.maps.Marker({
      position: { lat: spot.coords.lat, lng: spot.coords.lng },
      map: map,
      title: spot.name,
      icon: {
        url: getMarkerIconSvg(index + 1),
        scaledSize: new google.maps.Size(48, 48),
        anchor: new google.maps.Point(24, 48)
      },
      optimized: false
    });

    marker.addListener('click', () => scrollToListItem(index));
    markers.push(marker);
  });

  // Draw route polyline if available
  if (CRAWL_ROUTE_POLYLINE) {
    routePolyline = new google.maps.Polyline({
      map: map,
      path: google.maps.geometry.encoding.decodePath(CRAWL_ROUTE_POLYLINE),
      geodesic: true,
      strokeColor: '#6CB2D1',
      strokeOpacity: 0.7,
      strokeWeight: 3,
      clickable: false
    });
  }

  // Fit map to bounds with padding
  map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });

  // Handle light/dark mode changes
  document.addEventListener('theme-changed', updateMapTheme);

  // Setup scroll sync (highlight markers when list items are visible)
  setTimeout(setupScrollSync, 100);
}

function updateMapTheme() {
  if (!map) return;
  const isDark = document.body.classList.contains('dark');
  map.setOptions({ styles: isDark ? darkMapStyles : lightMapStyles });
}

function scrollToListItem(index) {
  const item = document.querySelector(`.crawl-item[data-index="${index}"]`);
  if (item) {
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    item.style.boxShadow = '0 0 0 3px #6CB2D1';
    setTimeout(() => {
      item.style.boxShadow = '';
    }, 2000);
  }
}

function panToMarker(index) {
  if (markers[index]) {
    const position = markers[index].getPosition();

    // Smoothly pan the map to this location
    map.panTo(position);

    // Unhighlight previously highlighted marker
    if (currentHighlightedIndex !== null && currentHighlightedIndex !== index) {
      unhighlightMarker(currentHighlightedIndex);
    }

    // Highlight the clicked marker
    highlightMarker(index);
    currentHighlightedIndex = index;

    // Scroll to list item
    const item = document.querySelector(`.crawl-item[data-index="${index}"]`);
    if (item) {
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Wait for Google Maps API to load
  if (typeof google !== 'undefined' && google.maps) {
    initMap();
  }
});

// Sync markers with list scrolling (highlight visible items)
function setupScrollSync() {
  const options = {
    threshold: 0.5
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const index = parseInt(entry.target.dataset.index);
      if (entry.isIntersecting) {
        highlightMarker(index);
      } else {
        unhighlightMarker(index);
      }
    });
  }, options);

  // Observe all list items
  document.querySelectorAll('.crawl-item').forEach(item => {
    observer.observe(item);
  });
}

function highlightMarker(index) {
  if (!markers[index]) return;

  const marker = markers[index];
  marker.setIcon({
    url: getMarkerIconSvg(index + 1),
    scaledSize: new google.maps.Size(64, 64),
    anchor: new google.maps.Point(32, 64)
  });
  marker.setZIndex(google.maps.Marker.MAX_ZINDEX + 1);
}

function unhighlightMarker(index) {
  if (!markers[index]) return;

  const marker = markers[index];
  marker.setIcon({
    url: getMarkerIconSvg(index + 1),
    scaledSize: new google.maps.Size(48, 48),
    anchor: new google.maps.Point(24, 48)
  });
  marker.setZIndex(index);
}

// Export functions for HTML onclick handlers
window.panToMarker = panToMarker;
