// Sky atlas: inside-out 3D celestial sphere of plate-solved observations.
//
// Camera sits at the origin and looks outward; everything else (tiles, grid,
// stars) lives on a sphere of radius R. OrbitControls is repurposed to rotate
// the camera in place by setting target = camera.position + look-direction,
// so the user drags to look around instead of orbiting an exterior pivot.
//
// Coordinate convention matches astronomy textbooks: RA in decimal hours
// (0..24), Dec in decimal degrees (-90..90). For a vector on the inside of
// the sphere as seen from origin, we negate X so RA increases to the east
// when you face it from inside — same handedness as a planetarium.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fetchJson, highlightNav, el } from './common.js';

highlightNav('atlas');

const SPHERE_RADIUS = 100;
const TILE_RADIUS = SPHERE_RADIUS * 0.985; // tiny bias inward so tiles sit
                                           // just in front of grid/stars.

// Hand-curated bright stars for orientation. Mag <= ~2.0, well spread across
// both hemispheres so there's always something familiar within view. This is
// enough to recognise constellations without bundling a full BSC dump.
const BRIGHT_STARS = [
  { name: 'Sirius',     ra: 6.7525,  dec: -16.7161, mag: -1.46 },
  { name: 'Canopus',    ra: 6.3992,  dec: -52.6957, mag: -0.74 },
  { name: 'Arcturus',   ra: 14.2610, dec:  19.1825, mag: -0.05 },
  { name: 'Rigil Kent', ra: 14.6600, dec: -60.8354, mag: -0.27 },
  { name: 'Vega',       ra: 18.6156, dec:  38.7837, mag:  0.03 },
  { name: 'Capella',    ra: 5.2782,  dec:  45.9980, mag:  0.08 },
  { name: 'Rigel',      ra: 5.2423,  dec:  -8.2017, mag:  0.13 },
  { name: 'Procyon',    ra: 7.6550,  dec:   5.2250, mag:  0.34 },
  { name: 'Achernar',   ra: 1.6286,  dec: -57.2367, mag:  0.46 },
  { name: 'Betelgeuse', ra: 5.9195,  dec:   7.4071, mag:  0.50 },
  { name: 'Hadar',      ra: 14.0637, dec: -60.3729, mag:  0.61 },
  { name: 'Altair',     ra: 19.8463, dec:   8.8683, mag:  0.77 },
  { name: 'Aldebaran',  ra: 4.5987,  dec:  16.5093, mag:  0.85 },
  { name: 'Antares',    ra: 16.4901, dec: -26.4320, mag:  1.09 },
  { name: 'Spica',      ra: 13.4199, dec: -11.1614, mag:  1.04 },
  { name: 'Pollux',     ra: 7.7553,  dec:  28.0262, mag:  1.14 },
  { name: 'Fomalhaut',  ra: 22.9608, dec: -29.6222, mag:  1.16 },
  { name: 'Deneb',      ra: 20.6905, dec:  45.2803, mag:  1.25 },
  { name: 'Mimosa',     ra: 12.7953, dec: -59.6886, mag:  1.25 },
  { name: 'Regulus',    ra: 10.1395, dec:  11.9672, mag:  1.40 },
  { name: 'Adhara',     ra: 6.9770,  dec: -28.9721, mag:  1.50 },
  { name: 'Shaula',     ra: 17.5601, dec: -37.1038, mag:  1.62 },
  { name: 'Castor',     ra: 7.5766,  dec:  31.8883, mag:  1.58 },
  { name: 'Gacrux',     ra: 12.5194, dec: -57.1133, mag:  1.63 },
  { name: 'Bellatrix',  ra: 5.4188,  dec:   6.3497, mag:  1.64 },
  { name: 'Elnath',     ra: 5.4382,  dec:  28.6075, mag:  1.65 },
  { name: 'Miaplacidus',ra: 9.2199,  dec: -69.7172, mag:  1.69 },
  { name: 'Alnilam',    ra: 5.6035,  dec:  -1.2019, mag:  1.69 },
  { name: 'Alnair',     ra: 22.1372, dec: -46.9609, mag:  1.74 },
  { name: 'Alioth',     ra: 12.9004, dec:  55.9598, mag:  1.76 },
  { name: 'Dubhe',      ra: 11.0621, dec:  61.7510, mag:  1.79 },
  { name: 'Mirfak',     ra: 3.4054,  dec:  49.8612, mag:  1.79 },
  { name: 'Wezen',      ra: 7.1399,  dec: -26.3933, mag:  1.83 },
  { name: 'Kaus Aust.', ra: 18.4029, dec: -34.3847, mag:  1.85 },
  { name: 'Alkaid',     ra: 13.7923, dec:  49.3133, mag:  1.86 },
  { name: 'Sargas',     ra: 17.6228, dec: -42.9978, mag:  1.86 },
  { name: 'Avior',      ra: 8.3752,  dec: -59.5097, mag:  1.86 },
  { name: 'Menkalinan', ra: 5.9921,  dec:  44.9475, mag:  1.90 },
  { name: 'Atria',      ra: 16.8111, dec: -69.0277, mag:  1.91 },
  { name: 'Alhena',     ra: 6.6285,  dec:  16.3993, mag:  1.93 },
  { name: 'Peacock',    ra: 20.4275, dec: -56.7350, mag:  1.94 },
  { name: 'Polaris',    ra: 2.5302,  dec:  89.2641, mag:  1.97 },
  { name: 'Mirzam',     ra: 6.3783,  dec: -17.9559, mag:  1.98 },
  { name: 'Alphard',    ra: 9.4597,  dec:  -8.6586, mag:  1.98 },
  { name: 'Hamal',      ra: 2.1196,  dec:  23.4624, mag:  2.00 },
  { name: 'Algol',      ra: 3.1361,  dec:  40.9556, mag:  2.12 },
  { name: 'Denebola',   ra: 11.8177, dec:  14.5720, mag:  2.13 },
  { name: 'Mizar',      ra: 13.3988, dec:  54.9254, mag:  2.27 },
  { name: 'Mintaka',    ra: 5.5334,  dec:  -0.2991, mag:  2.23 },
  { name: 'Alnitak',    ra: 5.6793,  dec:  -1.9426, mag:  1.79 },
  { name: 'Rasalhague', ra: 17.5822, dec:  12.5600, mag:  2.07 },
];

// Convert RA (hours) + Dec (degrees) to a Cartesian unit vector. We negate X
// so the inside-out view shows east-on-the-left, matching how planetarium
// software (and a real star chart held overhead) presents the sky.
function raDecToVec3(raHours, decDeg, radius = 1) {
  const raRad = (raHours / 24) * Math.PI * 2;
  const decRad = (decDeg / 180) * Math.PI;
  const cosDec = Math.cos(decRad);
  return new THREE.Vector3(
    -radius * cosDec * Math.cos(raRad),
     radius * Math.sin(decRad),
     radius * cosDec * Math.sin(raRad),
  );
}

const skyEl = document.getElementById('sky');
const tooltipEl = document.getElementById('sky-tooltip');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
skyEl.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  60,
  skyEl.clientWidth / Math.max(1, skyEl.clientHeight),
  0.1,
  SPHERE_RADIUS * 4,
);
camera.position.set(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
// OrbitControls assumes you orbit a target. To rotate-in-place, we keep
// the camera at the origin and shove the target out along the look vector
// every frame. This way drag still rotates the camera but it never strays
// from the origin.
controls.target.set(0, 0, 1);
controls.enablePan = false;
controls.enableZoom = true;
controls.zoomSpeed = 0.8;
controls.rotateSpeed = -0.35; // negative so drag-right looks right
controls.minDistance = 0.1;
controls.maxDistance = 0.1;  // forces camera to stay near origin
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;

// Soft inner background sphere so we can see "behind" missing tiles.
const bg = new THREE.Mesh(
  new THREE.SphereGeometry(SPHERE_RADIUS * 1.05, 32, 16),
  new THREE.MeshBasicMaterial({ color: 0x07090d, side: THREE.BackSide }),
);
scene.add(bg);

// --- Layers ---------------------------------------------------------------

const gridGroup = new THREE.Group();
const starGroup = new THREE.Group();
const tileGroup = new THREE.Group();
const eclipticGroup = new THREE.Group();
scene.add(gridGroup, starGroup, tileGroup, eclipticGroup);

function buildGrid() {
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x2c4060, transparent: true, opacity: 0.55,
  });
  const equatorMat = new THREE.LineBasicMaterial({
    color: 0x4a7ab0, transparent: true, opacity: 0.85,
  });

  // Declination parallels every 15°.
  for (let dec = -75; dec <= 75; dec += 15) {
    const pts = [];
    for (let raHr = 0; raHr <= 24; raHr += 0.25) {
      pts.push(raDecToVec3(raHr, dec, SPHERE_RADIUS));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    gridGroup.add(new THREE.Line(geo, dec === 0 ? equatorMat : lineMat));
  }
  // RA meridians every 2 hours.
  for (let raHr = 0; raHr < 24; raHr += 2) {
    const pts = [];
    for (let dec = -85; dec <= 85; dec += 5) {
      pts.push(raDecToVec3(raHr, dec, SPHERE_RADIUS));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    gridGroup.add(new THREE.Line(geo, lineMat));
  }
}

function buildEcliptic() {
  // Sun's path on the celestial sphere: tilted ~23.4° from the equator.
  const tilt = (23.4392911 / 180) * Math.PI;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const pts = [];
  for (let lonDeg = 0; lonDeg <= 360; lonDeg += 1) {
    const lon = (lonDeg / 180) * Math.PI;
    // Ecliptic in equatorial coords: standard rotation.
    const x = Math.cos(lon);
    const y = Math.sin(lon) * cosT;
    const z = Math.sin(lon) * sinT;
    // Reuse the RA/Dec convention via direct vector (negate X for inside-out).
    pts.push(new THREE.Vector3(-x, z, y).multiplyScalar(SPHERE_RADIUS));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0xc7894b, transparent: true, opacity: 0.7,
  });
  eclipticGroup.add(new THREE.Line(geo, mat));
}

function buildStars() {
  // Each star is a tiny sphere sized by magnitude. Spheres render cleaner
  // than gl_PointSize across platforms.
  for (const s of BRIGHT_STARS) {
    // Brightness curve: clamp to [-1.5, 2.5] then map to size + alpha.
    const m = Math.min(2.5, Math.max(-1.5, s.mag));
    const size = 0.18 + (2.5 - m) * 0.16;
    const intensity = 0.55 + (2.5 - m) * 0.13;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(intensity, intensity, intensity * 0.93),
      transparent: true,
      opacity: 0.9,
    });
    const star = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), mat);
    star.position.copy(raDecToVec3(s.ra, s.dec, SPHERE_RADIUS * 0.995));
    star.userData.starName = s.name;
    starGroup.add(star);
  }
}

// Fill in fainter procedural stars for ambience. Spread uniformly on the
// sphere, low brightness, no interactivity. This is the "everything else"
// layer — enough star noise so the bright stars don't sit on a void.
function buildAmbientStars(n = 1400) {
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Uniform spherical sampling.
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const v = new THREE.Vector3(r * Math.cos(t), u, r * Math.sin(t))
      .multiplyScalar(SPHERE_RADIUS * 0.99);
    positions[i * 3 + 0] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
    const c = 0.35 + Math.random() * 0.35;
    colors[i * 3 + 0] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c * (0.9 + Math.random() * 0.2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.4,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
  });
  starGroup.add(new THREE.Points(geo, mat));
}

const tileMeshes = []; // for raycasting
const textureLoader = new THREE.TextureLoader();
const placeholderMat = new THREE.MeshBasicMaterial({
  color: 0x344455, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
});

function buildTile(obs) {
  if (obs.solved_ra_hours == null || obs.solved_dec_degrees == null
      || !obs.solved_radius_deg) return null;

  // solved_radius_deg is the half-angle from frame center to corner. We
  // build a square tile that fully contains the frame circle; the textured
  // material gets the thumbnail mapped to the full square.
  const angularRadius = (obs.solved_radius_deg / 180) * Math.PI;
  const size = 2 * TILE_RADIUS * Math.tan(Math.min(angularRadius, Math.PI / 3));
  // Floor for clickability — tiny frames would be unselectable otherwise.
  const finalSize = Math.max(size, 1.2);

  const geo = new THREE.PlaneGeometry(finalSize, finalSize);
  // Start with placeholder; swap in texture once loaded.
  const mat = placeholderMat.clone();
  const tile = new THREE.Mesh(geo, mat);
  tile.position.copy(raDecToVec3(obs.solved_ra_hours, obs.solved_dec_degrees, TILE_RADIUS));
  // Face the origin (inside-out viewer).
  tile.lookAt(0, 0, 0);
  // Rotate around the look-axis by solved orientation (degrees, CW from N).
  if (typeof obs.solved_orientation_deg === 'number') {
    tile.rotateZ((obs.solved_orientation_deg / 180) * Math.PI);
  }
  tile.userData.obs = obs;

  if (obs.thumbnail_path) {
    textureLoader.load(
      `/uploads/${encodeURI(obs.thumbnail_path)}`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        // Inside-out: viewer sees the back face, so flip horizontally so the
        // image isn't mirrored.
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.x = -1;
        tex.offset.x = 1;
        tile.material = new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
        });
      },
      undefined,
      () => { /* keep placeholder on error */ },
    );
  }

  return tile;
}

// --- Interactivity --------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;

function setPointerFromEvent(ev) {
  const rect = skyEl.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickTile(ev) {
  setPointerFromEvent(ev);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(tileMeshes, false);
  return hits.length ? hits[0].object : null;
}

function tileLabel(obs) {
  const objId = obs.object_catalog && obs.object_catalog_number
    ? `${obs.object_catalog}${obs.object_catalog_number}`
    : '';
  return obs.title
    || [objId, obs.object_name].filter(Boolean).join(' · ')
    || `Observation #${obs.id}`;
}

skyEl.addEventListener('pointermove', (ev) => {
  // The OrbitControls drag uses the same pointer events, so only update
  // tooltip when the user isn't actively dragging.
  if (skyEl.classList.contains('dragging')) {
    tooltipEl.style.display = 'none';
    return;
  }
  const tile = pickTile(ev);
  if (tile === hovered) {
    if (hovered) positionTooltip(ev);
    return;
  }
  hovered = tile;
  if (!tile) {
    tooltipEl.style.display = 'none';
    skyEl.style.cursor = 'grab';
    return;
  }
  const obs = tile.userData.obs;
  const meta = [obs.telescope, obs.observed_at].filter(Boolean).join(' · ');
  tooltipEl.innerHTML = '';
  tooltipEl.appendChild(el('strong', { text: tileLabel(obs) }));
  if (meta) tooltipEl.appendChild(el('div', { class: 'hint', text: meta }));
  tooltipEl.style.display = 'block';
  skyEl.style.cursor = 'pointer';
  positionTooltip(ev);
});

function positionTooltip(ev) {
  const rect = skyEl.getBoundingClientRect();
  let x = ev.clientX - rect.left + 14;
  let y = ev.clientY - rect.top + 14;
  // Keep tooltip in-bounds.
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  if (x + tw > rect.width - 6) x = rect.width - tw - 6;
  if (y + th > rect.height - 6) y = rect.height - th - 6;
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

// Detect drags so a click doesn't fire after a rotate gesture.
let dragStart = null;
let didDrag = false;
skyEl.addEventListener('pointerdown', (ev) => {
  dragStart = { x: ev.clientX, y: ev.clientY };
  didDrag = false;
  skyEl.classList.add('dragging');
});
skyEl.addEventListener('pointerup', (ev) => {
  skyEl.classList.remove('dragging');
  if (dragStart) {
    const dx = ev.clientX - dragStart.x;
    const dy = ev.clientY - dragStart.y;
    if (Math.hypot(dx, dy) > 4) didDrag = true;
  }
  dragStart = null;
  if (didDrag) return;
  const tile = pickTile(ev);
  if (tile) {
    const obs = tile.userData.obs;
    window.location.href = `/observation.html?id=${obs.id}`;
  }
});
skyEl.addEventListener('pointerleave', () => {
  tooltipEl.style.display = 'none';
  hovered = null;
  skyEl.classList.remove('dragging');
});

// Wire layer checkboxes.
function bindLayer(id, group) {
  const cb = document.getElementById(id);
  cb.addEventListener('change', () => { group.visible = cb.checked; });
  group.visible = cb.checked;
}

// --- Resize + animate ----------------------------------------------------

function resize() {
  const w = skyEl.clientWidth;
  const h = skyEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

function animate() {
  // Pin the orbit target just in front of the camera every frame so dragging
  // rotates the look direction rather than orbiting a fixed point in space.
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// --- Data load ----------------------------------------------------------

function renderTargetList(solved) {
  const root = document.getElementById('atlas-targets');
  root.innerHTML = '';
  if (!solved.length) {
    root.appendChild(el('span', {
      class: 'hint',
      text: 'No plate-solved frames yet. Solve one from the admin observation page to drop it on the globe.',
    }));
    return;
  }
  for (const obs of solved) {
    root.appendChild(el('a', {
      href: `/observation.html?id=${obs.id}`,
      text: tileLabel(obs),
      title: obs.observed_at || '',
    }));
  }
}

async function loadAndRender() {
  buildGrid();
  buildEcliptic();
  buildStars();
  buildAmbientStars();
  bindLayer('layer-grid', gridGroup);
  bindLayer('layer-stars', starGroup);
  bindLayer('layer-tiles', tileGroup);
  bindLayer('layer-ecliptic', eclipticGroup);

  let payload;
  try {
    payload = await fetchJson('/api/observations/atlas');
  } catch {
    document.getElementById('atlas-subtitle').textContent =
      'Failed to load atlas data.';
    return;
  }

  const { solved, counts } = payload;
  document.getElementById('cnt-solved').textContent = counts.solved;
  document.getElementById('cnt-unsolved').textContent = counts.unsolved;
  document.getElementById('cnt-pending').textContent = counts.pending;
  document.getElementById('cnt-failed').textContent = counts.failed;

  for (const obs of solved) {
    const tile = buildTile(obs);
    if (!tile) continue;
    tileGroup.add(tile);
    tileMeshes.push(tile);
  }

  renderTargetList(solved);

  // Aim camera at the centroid of placed tiles so first render isn't blank.
  if (tileMeshes.length) {
    const centroid = new THREE.Vector3();
    for (const t of tileMeshes) centroid.add(t.position);
    centroid.divideScalar(tileMeshes.length).normalize();
    controls.target.copy(centroid.multiplyScalar(0.1));
    camera.lookAt(centroid);
  } else {
    // Default look: roughly toward Cygnus/Lyra (summer Milky Way), a nice
    // starting view for northern observers.
    const v = raDecToVec3(19.5, 35, 0.1);
    controls.target.copy(v);
    camera.lookAt(v.clone().multiplyScalar(100));
  }
}

new ResizeObserver(resize).observe(skyEl);
resize();
animate();
loadAndRender();
