// Shared helpers for the shelf pages.

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// Deterministic 0..1 from a string, so a bottle's lean/overlap never change between loads.
function seeded(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

async function loadWines() {
  const res = await fetch('wines.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('could not load wines.json');
  const { wines } = await res.json();
  return wines;
}

const wineTitle = (w) => `${w.producer} ${w.cuvee}${w.vintage ? ' ' + w.vintage : ''}`;

// Rough chalk outline, used on hover. Drawn from the PNG's alpha edge.
document.body.insertAdjacentHTML('afterbegin', `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="chalk" x="-30%" y="-6%" width="160%" height="112%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="fat"/>
    <feComposite in="fat" in2="SourceAlpha" operator="out" result="ring"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="4" result="noise"/>
    <feDisplacementMap in="ring" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -0.55" result="grain"/>
    <feFlood flood-color="#f6f3ea" result="white"/>
    <feComposite in="white" in2="rough" operator="in" result="line"/>
    <feComposite in="line" in2="grain" operator="in"/>
  </filter>
</defs></svg>`);
