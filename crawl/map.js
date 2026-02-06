// Google Maps initialization and logic for the crawl page
// This file is loaded in Phase 2 when the map <div> is added

let map;
let markers = [];
let routePolyline;

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
      <circle cx="24" cy="20" r="16" fill="#6CB2D1" stroke="#fff" stroke-width="2"/>
      <text x="24" y="26" font-size="18" font-weight="bold" text-anchor="middle" fill="#121212" font-family="Arial">${number}</text>
      <polygon points="24,40 16,28 32,28" fill="#6CB2D1"/>
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
    map.panTo(position);
    google.maps.event.trigger(markers[index], 'click');
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Wait for Google Maps API to load
  if (typeof google !== 'undefined' && google.maps) {
    initMap();
  }
});

// Export functions for HTML onclick handlers
window.panToMarker = panToMarker;
