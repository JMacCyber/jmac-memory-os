// Brain View: draws data/graph.json six ways on one canvas.
'use strict';

const CONFIG = {
  ringGap: 90,            // px between rings in Rings view
  areaSpread: 26,         // px between memories inside an area cluster
  forceTicks: 320,        // iterations for the Links layout
  forceRepel: 900,        // node-to-node push in Links layout
  forceSpring: 0.02,      // edge pull in Links layout
  forceLength: 40,        // resting edge length in Links layout
  timelineWidth: 1400,    // px width of the Timeline
  laneGap: 150,           // px between lanes in Timeline
  morphMs: 600,           // view change animation
  flyMs: 700,             // fly-to animation
  flyZoom: 2.2,           // zoom level after fly-to
  spinPerSec: 0.03,       // radians per second when Motion is on
  staleHours: 24,         // Built stat turns Amber after this
  labelZoom: 1.6,         // labels appear on their own above this zoom
  hitPx: 9,               // click and hover radius in screen px
  labelGutter: 84,        // px kept free on the left of the Timeline for lane names
  orbitRadius: 260,       // px radius of the 3D Orbit sphere
  orbitHubAt: 0.58,       // area hubs sit at this share of the sphere radius
  orbitRingAt: 1.45,      // the outer ring of kind badges, as a share of the sphere radius
  orbitRingDrop: 0.3,     // the ring sits this share of the radius below the equator
  orbitPerspective: 3.2,  // camera distance in sphere radii: lower = stronger depth
  orbitTilt: 0.55,        // radians the sphere leans its top toward you
  orbitSpinPerSec: 0.12,  // radians per second the Orbit turns on its own
  orbitDragRad: 0.006,    // radians of Orbit turn per px dragged
  circleSpacing: 14,      // px between nodes on the Circle
};

const TYPES = [
  ['record', '#6ea8fe', 'Record'], ['thread', '#3ecf8e', 'Thread'], ['artifact', '#f0b429', 'Artifact'],
  ['handoff', '#ef5b5b', 'Handoff'], ['project', '#c792ea', 'Project'], ['policy', '#4dd0e1', 'Policy'],
  ['prompt', '#ff9f68', 'Prompt'], ['schema', '#a3be8c', 'Schema'], ['global', '#e6e9ef', 'Global'],
  ['other', '#8a93a6', 'Other'],
];
const COLOR = Object.fromEntries(TYPES.map(t => [t[0], t[1]]));
COLOR.root = '#ffffff'; COLOR.area = '#9fb3d9';
const LABEL = Object.fromEntries(TYPES.map(t => [t[0], t[2]]));
LABEL.root = 'Root'; LABEL.area = 'Area';

const $ = s => document.querySelector(s);
const canvas = $('#c'), ctx = canvas.getContext('2d');
const S = {
  graph: null, nodes: [], byId: new Map(), out: new Map(), inn: new Map(), edges: [],
  view: 'rings', layouts: {}, cam: { x: 0, y: 0, k: 1 }, hover: null, selected: null,
  typeOnly: null, areaOnly: '', names: false, motion: false, spin: 0, anim: null, fly: null,
  orbit: null, yaw: 0, pitch: CONFIG.orbitTilt, areaColor: new Map(), badges: [], badge: null,
  session: null, dirty: false, started: false,
};

// ---------- data ----------
async function load(openId) {
  let g;
  try {
    const r = await fetch('/graph.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(await r.text());
    g = await r.json();
  } catch (e) {
    status('Could not read graph.json: ' + e.message, true);
    return;
  }
  S.graph = g; S.byId = new Map(); S.out = new Map(); S.inn = new Map(); S.layouts = {}; S.orbit = null;
  S.nodes = g.nodes.map(n => ({ ...n, x: 0, y: 0, tx: 0, ty: 0, deg: 0 }));
  S.nodes.forEach(n => { S.byId.set(n.id, n); S.out.set(n.id, []); S.inn.set(n.id, []); });
  S.edges = g.edges.filter(e => S.byId.has(e.from) && S.byId.has(e.to)).map(e => ({ a: S.byId.get(e.from), b: S.byId.get(e.to), why: e.why }));
  S.edges.forEach(e => { e.a.deg++; e.b.deg++; S.out.get(e.a.id).push(e); S.inn.get(e.b.id).push(e); });
  S.nodes.forEach(n => { n.r = n.kind === 'root' ? 14 : n.kind === 'area' ? 7 : 3 + Math.sqrt(n.deg) * 1.2; });
  S.mems = S.nodes.filter(isMem);
  S.areas = S.nodes.filter(n => n.kind === 'area').sort((a, b) => a.name.localeCompare(b.name));
  // One colour per area, biggest first, hues a golden angle apart so neighbours differ. Used by the 3D Orbit.
  S.areaColor = new Map([...S.areas].sort((a, b) => S.out.get(b.id).length - S.out.get(a.id).length || a.name.localeCompare(b.name))
    .map((a, i) => [a.area, `hsl(${Math.round(i * 137.5) % 360},72%,62%)`]));
  fillChrome();
  status(`${S.mems.length} memories · ${S.areas.length} areas · built ${g.built}`);
  if (S.started) {
    setView(S.view, false);
    if (openId && S.byId.has(openId)) openCard(S.byId.get(openId), false); else closeCard(false);
    writeHash(false);
    return;
  }
  S.started = true;
  const h = readHash();
  setView(VIEWS.includes(h.view) ? h.view : 'rings', false);
  fit(false);
  if (h.node && S.byId.has(h.node)) openCard(S.byId.get(h.node), false);
  requestAnimationFrame(frame);
  session();
}
const isMem = n => n.kind !== 'root' && n.kind !== 'area';
const VIEWS = ['rings', 'circle', 'areas', 'links', 'timeline', 'orbit'];

function fillChrome() {
  const g = S.graph, links = S.edges.filter(e => e.why === 'link').length;
  $('#s-areas').textContent = S.areas.length;
  $('#s-mem').textContent = S.mems.length;
  $('#s-links').textContent = links;
  $('#s-unres').textContent = g.unresolved.length;
  const ageH = (Date.now() - Date.parse(g.built)) / 36e5;
  $('#s-built').textContent = `Built ${g.built.replace('T', ' ').replace('Z', ' UTC')}` + (ageH > CONFIG.staleHours ? ' · Stale' : '');
  $('[data-stat="built"]').classList.toggle('amber', ageH > CONFIG.staleHours);
  const counts = {};
  S.mems.forEach(n => { counts[n.kind] = (counts[n.kind] || 0) + 1; });
  $('#types').innerHTML = TYPES.filter(t => counts[t[0]]).map(t =>
    `<li data-type="${t[0]}"><span class="dot" data-c="${t[1]}"></span>${t[2]}<span class="n">${counts[t[0]]}</span></li>`).join('');
  document.querySelectorAll('.dot[data-c]').forEach(d => { d.style.background = d.dataset.c; });
  if (S.areaOnly && !S.areas.some(a => a.area === S.areaOnly)) S.areaOnly = '';
  $('#area').innerHTML = '<option value="">All Projects</option>';
  $('#area').insertAdjacentHTML('beforeend', S.areas.map(a => `<option value="${esc(a.area)}">${esc(a.name)} (${S.out.get(a.id).length})</option>`).join(''));
  // 3D Orbit chips: one per area (colour, name, file count), then one per kind (shape, name, count).
  const tip = 'files name this project. Click to show only this area; click again for all.';
  $('#chips').innerHTML = `<div class="row"><button class="chip" data-area="" data-tip="All ${S.mems.length} files. Click to clear the area filter.">all areas</button>` + [...S.areaColor].map(([area, c]) => { const n = S.out.get('area:' + area).length;
    return `<button class="chip" data-area="${esc(area)}" data-c="${c}" data-tip="${n} ${tip}"><i class="d"></i>${esc(area)} <b>${n}</b></button>`; }).join('') +
    '</div><div class="row">' + TYPES.filter(t => counts[t[0]]).map(t => `<button class="chip" data-kind="${t[0]}" data-tip="${counts[t[0]]} ${t[2]} files, drawn as ${GLYPH[SHAPE[t[0]]]}. The kind also rides the outer ring as a badge. Click to show only this kind.">${GLYPH[SHAPE[t[0]]]} ${t[2]} <b>${counts[t[0]]}</b></button>`).join('') + '</div>';
  document.querySelectorAll('#chips [data-c]').forEach(c => c.style.setProperty('--c', c.dataset.c));
  chipState();
}
function chipState() {
  document.querySelectorAll('#chips [data-area]').forEach(c => { c.classList.toggle('off', !!S.areaOnly && c.dataset.area !== S.areaOnly); c.classList.toggle('on', c.dataset.area === S.areaOnly); });
  document.querySelectorAll('#chips [data-kind]').forEach(c => c.classList.toggle('off', !!S.typeOnly && c.dataset.kind !== S.typeOnly));
}

// ---------- layouts ----------
function layout(view) {
  if (S.layouts[view]) return S.layouts[view];
  const L = new Map();
  if (view === 'rings') {
    const order = TYPES.map(t => t[0]);
    L.set('root', [0, 0]);
    S.areas.forEach((a, i) => { const t = i / S.areas.length * 2 * Math.PI; L.set(a.id, [Math.cos(t) * CONFIG.ringGap, Math.sin(t) * CONFIG.ringGap]); });
    let ring = 2;
    order.forEach(k => {
      const on = S.mems.filter(n => n.kind === k).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
      if (!on.length) return;
      const r = ring++ * CONFIG.ringGap * (1 + on.length / 900);
      on.forEach((n, i) => { const t = i / on.length * 2 * Math.PI; L.set(n.id, [Math.cos(t) * r, Math.sin(t) * r]); });
    });
  } else if (view === 'areas') {
    L.set('root', [0, 0]);
    const golden = Math.PI * (3 - Math.sqrt(5));
    let placed = 0;
    const sized = S.areas.map(a => ({ a, kids: S.out.get(a.id).filter(e => e.why === 'area').map(e => e.b) }));
    sized.sort((p, q) => q.kids.length - p.kids.length);
    sized.forEach(({ a, kids }, i) => {
      const rad = CONFIG.areaSpread * Math.sqrt(kids.length + 1) + 30;
      const dist = 160 + Math.sqrt(placed) * CONFIG.areaSpread * 1.15 + rad;
      placed += kids.length + 12;
      const t = i * golden;
      const cx = Math.cos(t) * dist, cy = Math.sin(t) * dist;
      L.set(a.id, [cx, cy]);
      kids.forEach((n, j) => { const r = CONFIG.areaSpread * 0.55 * Math.sqrt(j + 1), u = (j + 1) * golden; L.set(n.id, [cx + Math.cos(u) * r, cy + Math.sin(u) * r]); });
    });
  } else if (view === 'links') {
    const seed = layout('areas');
    const P = S.nodes.map(n => { const p = seed.get(n.id) || [0, 0]; return { n, x: p[0] * 0.6, y: p[1] * 0.6, vx: 0, vy: 0 }; });
    const idx = new Map(P.map((p, i) => [p.n.id, i]));
    const E = S.edges.map(e => [idx.get(e.a.id), idx.get(e.b.id), e.why === 'link' ? 1.6 : 1]);
    for (let t = 0; t < CONFIG.forceTicks; t++) {
      const cool = 1 - t / CONFIG.forceTicks;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const p = P[i], q = P[j]; let dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 90000) continue;
        const f = CONFIG.forceRepel / d2; dx *= f; dy *= f;
        p.vx += dx; p.vy += dy; q.vx -= dx; q.vy -= dy;
      }
      E.forEach(([i, j, w]) => {
        const p = P[i], q = P[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
        const f = (d - CONFIG.forceLength) * CONFIG.forceSpring * w, fx = dx / d * f, fy = dy / d * f;
        p.vx += fx; p.vy += fy; q.vx -= fx; q.vy -= fy;
      });
      P.forEach(p => {
        p.vx -= p.x * 0.002; p.vy -= p.y * 0.002;
        const v = Math.hypot(p.vx, p.vy), cap = 20 * cool + 1;
        if (v > cap) { p.vx *= cap / v; p.vy *= cap / v; }
        p.x += p.vx; p.y += p.vy; p.vx *= 0.55; p.vy *= 0.55;
      });
    }
    P.forEach(p => L.set(p.n.id, [p.x, p.y]));
  } else if (view === 'timeline') {
    // Order, not scale: files are spaced evenly by last change, oldest left. Bulk commits put dozens of
    // files in the same minute, which a true time scale squeezes into one spot. A tick marks each new day.
    const lanes = TYPES.map(t => t[0]).filter(k => S.mems.some(n => n.kind === k));
    const W = CONFIG.timelineWidth, when = n => { const t = Date.parse(n.modified); return Number.isFinite(t) ? t : Infinity; };
    const sorted = [...S.mems].sort((a, b) => when(a) - when(b) || a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
    const step = W / Math.max(sorted.length - 1, 1), ticks = [];
    let day = '';
    sorted.forEach((n, i) => {
      const x = i * step - W / 2, d = when(n) === Infinity ? 'No Date' : new Date(when(n)).toLocaleDateString('en-CA');
      if (d !== day) { ticks.push({ x: x - step / 2, label: d }); day = d; }
      L.set(n.id, [x, (lanes.indexOf(n.kind) - (lanes.length - 1) / 2) * CONFIG.laneGap]);
    });
    S.timeline = { lanes, W, ticks };
  } else if (view === 'circle') {
    // Root in the middle; every other node on one ring, grouped by area then kind, so links cross the middle.
    const on = S.nodes.filter(n => n.kind !== 'root').sort((a, b) => a.area.localeCompare(b.area) || (a.kind === 'area' ? -1 : b.kind === 'area' ? 1 : 0) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    const R = on.length * CONFIG.circleSpacing / (2 * Math.PI);
    L.set('root', [0, 0]);
    on.forEach((n, i) => { const t = i / on.length * 2 * Math.PI - Math.PI / 2; L.set(n.id, [Math.cos(t) * R, Math.sin(t) * R]); });
  } else if (view === 'orbit') {
    orbit3d();
    S.nodes.forEach(n => { const p = S.orbit.get(n.id); if (p) { const q = turn(p); L.set(n.id, [q[0], q[1]]); } });
    return L;  // not cached: the Orbit turns, so its 2D spots change every frame
  }
  S.layouts[view] = L;
  return L;
}

// 3D Orbit: a wireframe sphere. The repo sits in the middle, each area is a hub inside the sphere
// (spread evenly by a Fibonacci spiral), and its files form a cloud around the hub. Positions are
// seeded by file id, so the same repo always gives the same picture.
function seeded(id) {
  let h = 2166136261;
  for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
}
function orbit3d() {
  if (S.orbit) return;
  const R = CONFIG.orbitRadius, P = new Map([['root', [0, 0, 0]]]), golden = Math.PI * (3 - Math.sqrt(5));
  const areas = S.areas.filter(a => S.areaColor.has(a.area)).sort((a, b) => [...S.areaColor.keys()].indexOf(a.area) - [...S.areaColor.keys()].indexOf(b.area));
  areas.forEach((a, i) => {
    const y = 1 - (i + 0.5) / areas.length * 2, s = Math.sqrt(1 - y * y), t = i * golden, d = R * CONFIG.orbitHubAt;
    const hub = [Math.cos(t) * s * d, -y * d, Math.sin(t) * s * d];
    P.set(a.id, hub);
    const kids = S.out.get(a.id).filter(e => e.why === 'area').map(e => e.b), spread = R * 0.2 * Math.cbrt(kids.length + 2);
    kids.forEach(n => {
      const rnd = seeded(n.id), u = rnd() * 2 - 1, th = rnd() * 2 * Math.PI, rr = spread * Math.cbrt(0.12 + 0.88 * rnd()), q = Math.sqrt(1 - u * u);
      let p = [hub[0] + Math.cos(th) * q * rr, hub[1] + u * rr, hub[2] + Math.sin(th) * q * rr];
      const m = Math.hypot(...p); if (m > R * 0.97) p = p.map(v => v * R * 0.97 / m);  // stay inside the sphere
      P.set(n.id, p);
    });
  });
  S.orbit = P;
  S.orbitKinds = TYPES.filter(t => S.mems.some(n => n.kind === t[0]));
}
// Turn a 3D point by yaw (around the vertical axis), then pitch (top leans toward you), then add
// perspective. Returns [x, y, z] in layout px; z > 0 faces you.
function turn([x, y, z]) {
  const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y2 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
  const f = CONFIG.orbitPerspective * CONFIG.orbitRadius, k = f / (f - z2);
  return [x1 * k, y2 * k, z2];
}

function setView(view, animate = true) {
  S.view = view;
  document.querySelectorAll('.views button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const L = layout(view);
  S.nodes.forEach(n => { const p = L.get(n.id); n.hidden = !p; n.z = 0; if (p) { n.tx = p[0]; n.ty = p[1]; } });
  if (!animate) S.nodes.forEach(n => { n.x = n.tx; n.y = n.ty; });
  else { S.nodes.forEach(n => { n.fx = n.x; n.fy = n.y; }); S.anim = { t0: performance.now() }; }
  S.spin = 0;
  $('#chips').hidden = view !== 'orbit';
  writeHash();
}

// ---------- visibility ----------
function visible(n) {
  if (n.hidden) return false;
  if (S.areaOnly && n.kind !== 'root' && n.area !== S.areaOnly) return false;
  if (S.typeOnly && isMem(n) && n.kind !== S.typeOnly) return false;
  return true;
}
function neighbours(n) {
  const set = new Set([n.id]);
  S.out.get(n.id).forEach(e => set.add(e.b.id));
  S.inn.get(n.id).forEach(e => set.add(e.a.id));
  return set;
}

// ---------- drawing ----------
function resize() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function toScreen(x, y) {
  const r = canvas.getBoundingClientRect(), c = Math.cos(S.spin), s = Math.sin(S.spin);
  const rx = x * c - y * s, ry = x * s + y * c;
  return [(rx - S.cam.x) * S.cam.k + r.width / 2, (ry - S.cam.y) * S.cam.k + r.height / 2];
}
function frame(now) {
  requestAnimationFrame(frame);
  if (!S.graph) return;
  if (S.anim) {
    const t = Math.min(1, (now - S.anim.t0) / CONFIG.morphMs), e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    S.nodes.forEach(n => { n.x = n.fx + (n.tx - n.fx) * e; n.y = n.fy + (n.ty - n.fy) * e; });
    if (t === 1) S.anim = null;
  }
  if (S.fly) {
    const t = Math.min(1, (now - S.fly.t0) / CONFIG.flyMs), e = 1 - (1 - t) ** 3;
    S.cam.x = S.fly.x0 + (S.fly.x1 - S.fly.x0) * e; S.cam.y = S.fly.y0 + (S.fly.y1 - S.fly.y0) * e; S.cam.k = S.fly.k0 + (S.fly.k1 - S.fly.k0) * e;
    if (t === 1) S.fly = null;
  }
  if (S.motion && (S.view === 'rings' || S.view === 'areas') && !S.hover && !S.fly) S.spin += CONFIG.spinPerSec / 60;
  if (S.view === 'orbit') {
    if (!S.hover && !S.badge && !drag && !S.fly) S.yaw += CONFIG.orbitSpinPerSec / 60;  // turns on its own; hover or drag holds it
    S.nodes.forEach(n => { const p = S.orbit.get(n.id); if (!p) return; const q = turn(p); n.tx = q[0]; n.ty = q[1]; n.z = q[2]; if (!S.anim) { n.x = n.tx; n.y = n.ty; } });
  }
  draw();
}
function draw() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  if (S.view === 'orbit') return drawOrbit(r);
  if (S.view === 'timeline') drawAxis(r);
  const focus = S.hover || S.selected, near = focus ? neighbours(focus) : null;
  ctx.lineWidth = 1;
  for (const e of S.edges) {
    if (!visible(e.a) || !visible(e.b)) continue;
    if (S.view === 'timeline' && e.why !== 'link') continue;
    const lit = focus && (e.a === focus || e.b === focus);
    if (focus && !lit && S.view !== 'links' && e.why === 'area') continue;
    if (S.view === 'circle' && e.why === 'area' && !lit) continue;  // area spokes would hide the links
    const [x1, y1] = toScreen(e.a.x, e.a.y), [x2, y2] = toScreen(e.b.x, e.b.y);
    ctx.strokeStyle = lit ? 'rgba(110,168,254,.9)' : e.why === 'link' ? `rgba(199,146,234,${focus ? .08 : .35})` : `rgba(140,150,170,${focus ? .03 : .09})`;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const showAll = S.names || S.cam.k >= CONFIG.labelZoom, labels = [];
  ctx.font = '11px -apple-system, sans-serif';
  for (const n of S.nodes) {
    if (!visible(n)) continue;
    const [x, y] = toScreen(n.x, n.y);
    const rad = n.r * Math.max(0.6, Math.min(S.cam.k, 2.5));
    if (x < -40 || y < -40 || x > r.width + 40 || y > r.height + 40) continue;
    ctx.globalAlpha = near && !near.has(n.id) ? 0.12 : 1;
    ctx.fillStyle = COLOR[n.kind] || COLOR.other;
    ctx.beginPath();
    if (n.kind === 'area') ctx.rect(x - rad, y - rad, rad * 2, rad * 2);
    else ctx.arc(x, y, rad, 0, 2 * Math.PI);
    ctx.fill();
    if (n.kind === 'root' || n === S.selected) { ctx.strokeStyle = '#6ea8fe'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    const label = n.kind === 'root' || (n.kind === 'area' && (S.view === 'areas' || S.view === 'circle')) || showAll || (near && near.has(n.id));
    if (label) labels.push({ n, x, y, rad, pri: n === focus ? 0 : n.kind === 'root' ? 1 : near && near.has(n.id) ? 2 : n.kind === 'area' ? 3 : 4 });
  }
  ctx.globalAlpha = 1;
  drawLabels(labels, r);
}
// Labels never overlap: most important first; each tries right, left, above, below of its dot and is
// skipped if all four are taken. Hover a dot to see a skipped name.
function drawLabels(labels, r, pre = []) {
  const taken = S.view === 'timeline' ? [[0, 0, CONFIG.labelGutter, r.height]] : [...pre];
  const free = b => b[0] >= 0 && b[2] <= r.width && b[1] >= 0 && b[3] <= r.height && !taken.some(t => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]);
  labels.sort((a, b) => a.pri - b.pri || b.n.deg - a.n.deg);
  ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0d1017';
  const font = ctx.font;
  for (const L of labels) {
    ctx.font = L.font || font;
    const text = L.text || L.n.name, sub = L.sub ? 12 : 0, w = Math.max(ctx.measureText(text).width, L.sub ? ctx.measureText(L.sub).width : 0), { x, y, rad } = L;
    const spots = [[x + rad + 4, y + 4 - sub / 2], [x - rad - 4 - w, y + 4 - sub / 2], [x - w / 2, y - rad - 4 - sub], [x - w / 2, y + rad + 12]];
    const at = spots.map(([lx, ly]) => [lx, ly, [lx - 1, ly - 10, lx + w + 1, ly + 3 + sub]]).find(s => free(s[2]));
    if (!at && L.pri > 1) continue;
    const [lx, ly, box] = at || [spots[0][0], spots[0][1], null];
    if (box) taken.push(box);
    ctx.strokeText(text, lx, ly); ctx.fillStyle = L.color || '#e6e9ef'; ctx.fillText(text, lx, ly);
    if (L.sub) { ctx.strokeText(L.sub, lx, ly + sub); ctx.fillStyle = L.subColor || '#8a93a6'; ctx.fillText(L.sub, lx, ly + sub); }
  }
  ctx.font = font;
  ctx.lineWidth = 1;
  if (S.view === 'timeline') drawLanes(r);
}
// ---------- 3D Orbit drawing ----------
// Shape by kind (colour is by area in this view). GLYPH is the same shape as text, for the chips.
const SHAPE = { record: 'circle', thread: 'diamond', artifact: 'square', handoff: 'triangle', project: 'target', policy: 'hexagon', prompt: 'down', schema: 'box', global: 'star', other: 'circle' };
const GLYPH = { circle: '●', diamond: '◆', square: '■', triangle: '▲', target: '◎', hexagon: '⬡', down: '▼', box: '□', star: '✦' };
function poly(x, y, s, n, a0, inner) {
  ctx.beginPath();
  const m = inner ? n * 2 : n;
  for (let i = 0; i < m; i++) { const a = a0 + i * 2 * Math.PI / m, d = inner && i % 2 ? s * inner : s; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d); }
  ctx.closePath();
}
function shape(kind, x, y, s) {
  const sh = SHAPE[kind] || 'circle';
  ctx.lineWidth = 1.2;
  if (sh === 'target') { [1.35, 0.8].forEach(f => { ctx.beginPath(); ctx.arc(x, y, s * f, 0, 2 * Math.PI); ctx.stroke(); }); ctx.beginPath(); ctx.arc(x, y, s * 0.35, 0, 2 * Math.PI); ctx.fill(); return; }
  if (sh === 'box') { ctx.strokeRect(x - s, y - s, 2 * s, 2 * s); return; }
  if (sh === 'hexagon') { poly(x, y, s * 1.2, 6, Math.PI / 6); ctx.stroke(); return; }
  if (sh === 'diamond') poly(x, y, s * 1.3, 4, 0);
  else if (sh === 'square') poly(x, y, s * 1.25, 4, Math.PI / 4);
  else if (sh === 'triangle') poly(x, y, s * 1.4, 3, -Math.PI / 2);
  else if (sh === 'down') poly(x, y, s * 1.4, 3, Math.PI / 2);
  else if (sh === 'star') poly(x, y, s * 1.5, 4, -Math.PI / 2, 0.45);
  else { ctx.beginPath(); ctx.arc(x, y, s, 0, 2 * Math.PI); }
  ctx.fill();
}
// Line icon per kind, drawn inside the ring badges.
function icon(kind, x, y, s) {
  ctx.beginPath();
  const M = (a, b) => ctx.moveTo(x + a * s, y + b * s), L = (a, b) => ctx.lineTo(x + a * s, y + b * s);
  if (kind === 'record') { ctx.rect(x - 0.7 * s, y - s, 1.4 * s, 2 * s); M(-0.4, -0.3); L(0.4, -0.3); M(-0.4, 0.2); L(0.4, 0.2); }
  else if (kind === 'thread') { ctx.rect(x - s, y - 0.75 * s, 2 * s, 1.3 * s); M(-0.4, 0.55); L(-0.7, 1); L(0, 0.55); }
  else if (kind === 'artifact') { poly(x, y, s, 6, Math.PI / 6); M(0, 0); L(0, -1); M(0, 0); L(0.87, 0.5); M(0, 0); L(-0.87, 0.5); }
  else if (kind === 'handoff') { M(-1, 0); L(1, -0.8); L(0.2, 1); L(-0.1, 0.15); ctx.closePath(); M(-0.1, 0.15); L(1, -0.8); }
  else if (kind === 'project') { M(-1, 0.8); L(-1, -0.7); L(-0.3, -0.7); L(-0.1, -0.45); L(1, -0.45); L(1, 0.8); ctx.closePath(); }
  else if (kind === 'policy') { M(0, -1); L(0.85, -0.6); ctx.quadraticCurveTo(x + 0.8 * s, y + 0.6 * s, x, y + s); ctx.quadraticCurveTo(x - 0.8 * s, y + 0.6 * s, x - 0.85 * s, y - 0.6 * s); ctx.closePath(); }
  else if (kind === 'prompt') { M(-0.8, 0.8); L(-0.6, 0.2); L(0.5, -0.9); L(0.9, -0.5); L(-0.2, 0.6); ctx.closePath(); }
  else if (kind === 'schema') { ctx.ellipse(x, y - 0.6 * s, 0.8 * s, 0.3 * s, 0, 0, 2 * Math.PI); M(-0.8, -0.6); L(-0.8, 0.6); M(0.8, -0.6); L(0.8, 0.6); ctx.moveTo(x + 0.8 * s, y + 0.6 * s); ctx.ellipse(x, y + 0.6 * s, 0.8 * s, 0.3 * s, 0, 0, Math.PI); }
  else if (kind === 'global') { ctx.arc(x, y, s, 0, 2 * Math.PI); ctx.moveTo(x + 0.45 * s, y); ctx.ellipse(x, y, 0.45 * s, s, 0, 0, 2 * Math.PI); M(-1, 0); L(1, 0); }
  else ctx.arc(x, y, 0.3 * s, 0, 2 * Math.PI);
  ctx.stroke();
}
function drawOrbit(r) {
  const R = CONFIG.orbitRadius, k = S.cam.k, zoom = Math.max(0.7, Math.min(k, 2.5));
  const near01 = z => Math.max(0, Math.min(1, (z / R + 1) / 2));  // 0 = far side, 1 = near side
  // Night sky: navy in the middle, a warm glow at the left and right edges.
  let g = ctx.createRadialGradient(r.width / 2, r.height / 2, 0, r.width / 2, r.height / 2, Math.max(r.width, r.height) * 0.75);
  g.addColorStop(0, '#0f1728'); g.addColorStop(1, '#06080e'); ctx.fillStyle = g; ctx.fillRect(0, 0, r.width, r.height);
  [[0, 0.35, 0.16], [r.width, 0.6, 0.08]].forEach(([gx, gy, a]) => {
    g = ctx.createRadialGradient(gx, r.height * gy, 0, gx, r.height * gy, r.width * 0.55);
    g.addColorStop(0, `rgba(255,140,60,${a})`); g.addColorStop(1, 'rgba(255,140,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, r.width, r.height);
  });
  // Wireframe: each line is cut into short pieces so the far side can be fainter than the near side.
  const line = (f, n, a0, a1) => {
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const q = turn(f(i / n * 2 * Math.PI)), [x, y] = toScreen(q[0], q[1]);
      if (prev) { ctx.globalAlpha = a0 + (a1 - a0) * near01((q[2] + prev[2]) / 2); ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke(); }
      prev = [x, y, q[2]];
    }
  };
  ctx.lineWidth = 1; ctx.strokeStyle = '#a9b8d8';
  for (let m = 0; m < 6; m++) { const ph = m * Math.PI / 6; line(t => [R * Math.sin(t) * Math.cos(ph), -R * Math.cos(t), R * Math.sin(t) * Math.sin(ph)], 72, 0.02, 0.09); }
  [-60, -30, 0, 30, 60].forEach(d => { const a = d * Math.PI / 180, y = -R * Math.sin(a), c = R * Math.cos(a); line(t => [c * Math.cos(t), y, c * Math.sin(t)], 72, 0.02, 0.09); });
  const f = CONFIG.orbitPerspective * R, [cx, cy] = toScreen(0, 0);
  ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(cx, cy, R * f / Math.sqrt(f * f - R * R) * k, 0, 2 * Math.PI); ctx.stroke();
  // Outer ring with one badge per kind.
  const RR = R * CONFIG.orbitRingAt, ring = t => [RR * Math.cos(t), R * CONFIG.orbitRingDrop, RR * Math.sin(t)];
  ctx.strokeStyle = '#dfe6f5'; line(ring, 144, 0.12, 0.5);
  S.badges = (S.orbitKinds || []).map((t, i) => { const q = turn(ring(i / S.orbitKinds.length * 2 * Math.PI)), [x, y] = toScreen(q[0], q[1]); return { kind: t[0], x, y, z: q[2], r: (7 + 5 * near01(q[2])) * zoom }; });
  const badge = b => {
    const on = !S.typeOnly || S.typeOnly === b.kind;
    ctx.globalAlpha = (0.35 + 0.65 * near01(b.z)) * (on ? 1 : 0.3);
    poly(b.x, b.y, b.r, 6, Math.PI / 6); ctx.fillStyle = '#0c111b'; ctx.fill();
    ctx.lineWidth = b === S.badge ? 2 : 1.3; ctx.strokeStyle = b === S.badge ? '#ffffff' : '#c9d3e8'; ctx.stroke();
    ctx.lineWidth = 1.2; icon(b.kind, b.x, b.y, b.r * 0.45);
  };
  S.badges.filter(b => b.z < 0).forEach(badge);
  // Links: faint, fainter on the far side. Area spokes fainter still.
  const focus = S.hover || S.selected, near = focus ? neighbours(focus) : null, col = n => S.areaColor.get(n.area) || '#8a93a6';
  ctx.lineWidth = 1;
  for (const e of S.edges) {
    if (!visible(e.a) || !visible(e.b)) continue;
    const lit = focus && (e.a === focus || e.b === focus), d = near01((e.a.z + e.b.z) / 2);
    if (focus && !lit && e.why === 'area') continue;
    const [x1, y1] = toScreen(e.a.x, e.a.y), [x2, y2] = toScreen(e.b.x, e.b.y);
    ctx.globalAlpha = lit ? 0.9 : focus ? 0.04 : e.why === 'link' ? 0.06 + 0.16 * d : 0.02 + 0.04 * d;
    ctx.strokeStyle = lit ? '#ffffff' : e.why === 'link' ? '#d7deec' : col(e.a.kind === 'root' ? e.b : e.a);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // Nodes, far side first.
  const showAll = S.names || k >= CONFIG.labelZoom, labels = [], pre = [], mono = '9px ui-monospace, Menlo, monospace';
  let root = null;
  for (const n of [...S.nodes].sort((a, b) => a.z - b.z)) {
    if (!visible(n)) continue;
    const [x, y] = toScreen(n.x, n.y);
    if (x < -40 || y < -40 || x > r.width + 40 || y > r.height + 40) continue;
    const d = near01(n.z), sc = (0.55 + 0.55 * d) * zoom, c = col(n);
    ctx.globalAlpha = (near && !near.has(n.id) ? 0.12 : 1) * (0.3 + 0.62 * d);
    ctx.fillStyle = c; ctx.strokeStyle = c;
    let rad;
    if (n.kind === 'root') {
      rad = 12 * zoom; root = { x, y, rad };
      ctx.globalAlpha = 1; ctx.shadowColor = '#ff8a3d'; ctx.shadowBlur = 22;
      poly(x, y, rad, 6, Math.PI / 6); ctx.fillStyle = '#1b130d'; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = '#ff8a3d'; ctx.stroke();
      ctx.shadowBlur = 0; poly(x, y, rad * 0.5, 6, Math.PI / 6); ctx.lineWidth = 1.4; ctx.stroke();
    } else if (n.kind === 'area') {
      rad = 6.5 * sc;
      ctx.shadowColor = c; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#0b0f17'; ctx.font = `bold ${Math.max(7, Math.round(rad * 1.2))}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
      ctx.fillText(n.name[0].toUpperCase(), x, y + rad * 0.38); ctx.textAlign = 'left';
      if (n !== S.hover) labels.push({ n, x, y, rad, pri: n === focus ? 0 : 3, text: n.name.toUpperCase(), sub: String(S.out.get(n.id).length), subColor: c, font: mono, color: '#aeb6c8' });
    } else {
      rad = (1.3 + Math.sqrt(n.deg) * 0.45) * sc; shape(n.kind, x, y, rad);
      if (n !== S.hover && (showAll || (near && near.has(n.id)))) labels.push({ n, x, y, rad, pri: n === focus ? 0 : near && near.has(n.id) ? 2 : 4 });
    }
    if (n === S.selected) { ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, 2 * Math.PI); ctx.stroke(); }
  }
  S.badges.filter(b => b.z >= 0).forEach(badge);
  ctx.globalAlpha = 1; ctx.lineWidth = 1;
  // The repo name in a box under the root hexagon.
  if (root) {
    ctx.font = '600 10px ui-monospace, Menlo, monospace';
    const t = S.byId.get('root').name.toUpperCase(), w = ctx.measureText(t).width, bx = root.x - w / 2 - 6, by = root.y + root.rad + 6;
    if (S.hover?.kind !== 'root') {
      ctx.fillStyle = 'rgba(8,10,16,.88)'; ctx.fillRect(bx, by, w + 12, 16);
      ctx.strokeStyle = 'rgba(255,138,61,.5)'; ctx.strokeRect(bx, by, w + 12, 16);
      ctx.fillStyle = '#f3f5fa'; ctx.fillText(t, bx + 6, by + 11.5);
    }
    pre.push([bx, by, bx + w + 12, by + 16], [root.x - root.rad, root.y - root.rad, root.x + root.rad, root.y + root.rad]);
  }
  const chips = $('#chips'); if (!chips.hidden) pre.push([0, 0, r.width, chips.offsetHeight + 10]);
  ctx.font = '11px -apple-system, sans-serif';
  drawLabels(labels, r, pre);
  if (S.hover) hoverTag(S.hover, r);
}
// Hover tag: a short kind tag, then the name and the start of the description, in one dark box.
function hoverTag(n, r) {
  const [x, y] = toScreen(n.x, n.y), tag = (n.kind === 'root' ? 'repo' : n.kind).slice(0, 5).toUpperCase();
  const text = n.name + (n.description ? ' · ' + (n.description.length > 48 ? n.description.slice(0, 47) + '…' : n.description) : '');
  ctx.font = '600 9px ui-monospace, Menlo, monospace'; const tw = ctx.measureText(tag).width;
  ctx.font = '11px -apple-system, sans-serif'; const w = Math.min(ctx.measureText(text).width, r.width - tw - 40);
  let bx = x - (tw + w + 22) / 2, by = y + 18;
  bx = Math.max(4, Math.min(bx, r.width - tw - w - 26)); if (by + 20 > r.height) by = y - 38;
  ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(8,10,16,.94)'; ctx.fillRect(bx, by, tw + w + 22, 20);
  ctx.strokeStyle = 'rgba(160,172,196,.35)'; ctx.strokeRect(bx, by, tw + w + 22, 20);
  ctx.fillStyle = n.kind === 'root' ? '#ff8a3d' : S.areaColor.get(n.area) || '#8a93a6';
  ctx.font = '600 9px ui-monospace, Menlo, monospace'; ctx.fillText(tag, bx + 7, by + 13.5);
  ctx.fillStyle = '#e6e9ef'; ctx.font = '11px -apple-system, sans-serif';
  ctx.save(); ctx.beginPath(); ctx.rect(bx + tw + 13, by, w + 4, 20); ctx.clip(); ctx.fillText(text, bx + tw + 14, by + 14); ctx.restore();
}
// Timeline lane names sit in a fixed gutter on the left, so dots and pans never cover them.
function drawLanes(r) {
  const T = S.timeline; if (!T) return;
  ctx.fillStyle = 'rgba(13,16,23,.92)'; ctx.fillRect(0, 0, CONFIG.labelGutter, r.height);
  ctx.strokeStyle = 'rgba(140,150,170,.25)'; ctx.beginPath(); ctx.moveTo(CONFIG.labelGutter, 0); ctx.lineTo(CONFIG.labelGutter, r.height); ctx.stroke();
  ctx.fillStyle = '#8a93a6';
  T.lanes.forEach((k, i) => { const [, y] = toScreen(0, (i - (T.lanes.length - 1) / 2) * CONFIG.laneGap); if (y > 18 && y < r.height) ctx.fillText(LABEL[k], 8, y + 4); });
}
function drawAxis(r) {
  const T = S.timeline; if (!T) return;
  ctx.fillStyle = '#8a93a6'; ctx.strokeStyle = 'rgba(140,150,170,.15)'; ctx.font = '11px -apple-system, sans-serif';
  let lastLabel = -Infinity;
  T.ticks.forEach(t => {
    const [x] = toScreen(t.x, 0);
    if (x <= CONFIG.labelGutter || x >= r.width) return;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, r.height); ctx.stroke();
    if (x - lastLabel > 70) { ctx.fillText(t.label.slice(5), x + 3, 14); lastLabel = x; }  // MM-DD; skip if it would overlap the last one
  });
}

// ---------- camera ----------
function fit(animate = true) {
  const vis = S.nodes.filter(visible); if (!vis.length) return;
  const xs = vis.map(n => n.tx), ys = vis.map(n => n.ty), r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) { requestAnimationFrame(() => fit(animate)); return; }
  if (S.view === 'orbit') {  // fit the ring across and the sphere top to bottom, below the chips
    orbit3d();
    const top = $('#chips').hidden ? 0 : $('#chips').offsetHeight + 8, R = CONFIG.orbitRadius, RR = R * CONFIG.orbitRingAt, pts = [];
    for (let i = 0; i < 72; i++) { const t = i / 72 * 2 * Math.PI; pts.push(turn([RR * Math.cos(t), R * CONFIG.orbitRingDrop, RR * Math.sin(t)]), turn([R * Math.cos(t), R * Math.sin(t), 0].map((v, j) => j === 2 ? 0 : v))); }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), minY = Math.min(...ys, -R * 1.05), maxY = Math.max(...ys);
    const k = Math.min(r.width / (Math.max(...xs) - Math.min(...xs) + 40), (r.height - top) / (maxY - minY + 40), 3);
    go(0, (minY + maxY) / 2 - top / 2 / k, k, animate); return;
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const left = S.view === 'timeline' ? CONFIG.labelGutter : 0;
  const k = Math.min((r.width - left) / (maxX - minX + 80), r.height / (maxY - minY + 80), 3);
  go((minX + maxX) / 2 - left / 2 / k, (minY + maxY) / 2, k, animate);
}
function go(x, y, k, animate = true) {
  S.spin = 0;
  if (!animate) { S.cam = { x, y, k }; return; }
  S.fly = { t0: performance.now(), x0: S.cam.x, y0: S.cam.y, k0: S.cam.k, x1: x, y1: y, k1: k };
}
function flyTo(n) {
  if (S.areaOnly && n.area !== S.areaOnly) { S.areaOnly = ''; $('#area').value = ''; chipState(); }
  if (S.typeOnly && isMem(n) && n.kind !== S.typeOnly) setType(null);
  if (S.view === 'orbit' && S.orbit.has(n.id)) {  // turn the Orbit so the memory is at the front
    const [x, , z] = S.orbit.get(n.id); S.yaw = Math.atan2(-x, z);
    const q = turn(S.orbit.get(n.id)); go(q[0], q[1], Math.max(S.cam.k, CONFIG.flyZoom)); return;
  }
  go(n.tx, n.ty, Math.max(S.cam.k, CONFIG.flyZoom));
}
function hit(mx, my) {
  let best = null, bd = Infinity;
  for (const n of S.nodes) {
    if (!visible(n) || false) continue;
    const [x, y] = toScreen(n.x, n.y), d = Math.hypot(x - mx, y - my), lim = Math.max(CONFIG.hitPx, n.r * S.cam.k);
    if (d < lim && d < bd) { bd = d; best = n; }
  }
  return best;
}

// ---------- card ----------
function openCard(n, push = true) {
  if (!leaveOk()) return;
  S.selected = n;
  const outL = S.out.get(n.id), inL = S.inn.get(n.id);
  const item = e => { const m = e; return `<li data-go="${esc(m.id)}"><span class="dot" data-c="${COLOR[m.kind] || COLOR.other}"></span>${esc(m.name)}<small>${LABEL[m.kind] || m.kind}${m.area && m.kind !== 'area' ? ' · ' + esc(m.area) : ''}</small></li>`; };
  const list = (title, arr, tip) => arr.length ? `<h4>${title} (${arr.length}) <i class="tip" data-tip="${tip}">i</i></h4><ul>${arr.map(item).join('')}</ul>` : '';
  const unres = S.graph.unresolved.filter(u => u.from === n.id);
  let html = `<h3 id="card-title">${esc(n.name)}</h3>
    <div class="meta">${LABEL[n.kind] || n.kind}${n.area && n.kind !== 'area' ? ' · Area ' + esc(n.area) : ''}${n.modified ? ' · Changed ' + esc(n.modified.slice(0, 10)) : ''} · ${n.deg} links</div>
    <p class="desc">${esc(n.description || '')}</p>`;
  if (n.path) html += `<div class="path">${esc(n.path)}</div>`;
  html += `<div class="row"><button data-act="fly">Fly To</button>${n.path ? '<button data-act="copy">Copy Path</button>' : ''}${isMem(n) ? '<button data-act="open">Open File</button><button data-act="edit">Edit</button><button data-act="archive">Archive</button>' : '<button data-act="new">New File' + (n.kind === 'area' ? ' Here' : '') + '</button>'}</div><div id="filebox"></div>`;
  if (n.kind === 'root') html += (n.url ? `<p><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a></p>` : '') + list('Areas', outL.map(e => e.b), 'Every project named in the repo files: the project: field, else a Project: line, else the folder path.');
  else if (n.kind === 'area') html += list('Files', outL.map(e => e.b).sort((a, b) => a.name.localeCompare(b.name)), 'Every repo file that names this project.');
  else {
    html += list('Links Out', outL.filter(e => e.why === 'link').map(e => e.b), 'Files this one points to through related:, supersedes:, [[name]] or a Markdown link.');
    html += list('Links In', inL.filter(e => e.why === 'link').map(e => e.a), 'Files that point to this one.');
    if (unres.length) html += `<h4>Unresolved (${unres.length}) <i class="tip" data-tip="related:, supersedes: or [[name]] entries in this file that match no file in the repo.">i</i></h4><ul>${unres.map(u => `<li>${esc(u.target)}</li>`).join('')}</ul>`;
    const R = S.graph.repo || {};
    if (R.url && n.rel) html += `<p><a href="${esc(R.url)}/blob/${esc(R.branch || 'main')}/${n.rel.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noopener noreferrer">Open on GitHub</a></p>`;
    html += `<p class="note">Edit and Archive write to the memory repo and make one local git commit each. Nothing is pushed: see Not Pushed.</p>`;
  }
  showCard(html);
  if (push) writeHash(true);
}
function openList(title, items, tip) {
  if (!leaveOk()) return;
  S.selected = null;
  showCard(`<h3 id="card-title">${esc(title)}</h3><p class="note">${esc(tip)}</p><ul>${items.join('')}</ul>`);
}
function showCard(html) {
  S.dirty = false;
  $('#card-body').innerHTML = html;
  $('#card-body').querySelectorAll('.dot[data-c]').forEach(d => { d.style.background = d.dataset.c; });
  $('#card').hidden = false; $('#shade').hidden = false;
  $('#card-x').focus();
}
function closeCard(push = true) {
  if ($('#card').hidden) return;
  if (!leaveOk()) return;
  S.dirty = false;
  $('#card').hidden = true; $('#shade').hidden = true; S.selected = null;
  if (push) writeHash(true);
}
async function openFile(n) {
  const box = $('#filebox');
  box.innerHTML = '<p class="note">Reading…</p>';
  try {
    const r = await fetch('/file?id=' + encodeURIComponent(n.id), { cache: 'no-store' });
    const t = await r.text();
    box.innerHTML = r.ok ? `<pre>${esc(t)}</pre>` : `<p class="note">Could not read: ${esc(t)}</p>`;
  } catch (e) { box.innerHTML = `<p class="note">Could not read: ${esc(e.message)}</p>`; }
}

// ---------- create, edit, archive (all writes go to the server, which commits locally) ----------
function leaveOk() { return !S.dirty || confirm('Discard unsaved changes?'); }
async function session() {
  try {
    const r = await fetch('/api/session', { cache: 'no-store' });
    if (!r.ok) throw new Error(await r.text());
    S.session = await r.json();
  } catch (e) { S.session = null; }
  gitChip();
}
function gitChip() {
  const a = S.session?.git?.ahead;
  $('#s-git').textContent = a ?? '–';
  $('[data-stat="git"]').classList.toggle('amber', a > 0);
}
async function api(path, body) {
  if (!S.session) await session();
  if (!S.session) return { ok: false, text: 'no write session: is serve.py running?' };
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brain-Token': S.session.token }, body: JSON.stringify(body) });
  const t = await r.text();
  let data = null; try { data = JSON.parse(t); } catch (e) { /* plain text error */ }
  return { ok: r.ok, code: r.status, data, text: t };
}
function msg(text, bad) { const m = $('#edmsg'); if (m) { m.textContent = text; m.classList.toggle('red', !!bad); } }
async function done(res, verb) {
  S.session.git = res.data.git; gitChip();
  const note = `${verb} ${res.data.rel}${res.data.commit ? ' · Commit ' + res.data.commit : ''} · ${res.data.git.ahead ?? '?'} not pushed`;
  S.dirty = false;
  await load(res.data.archived_to ? 'area:' + (S.selected?.area || '') : res.data.id);
  status(note);
}
async function openEditor(n) {
  const box = $('#filebox');
  box.innerHTML = '<p class="note">Reading…</p>';
  const r = await fetch('/file?id=' + encodeURIComponent(n.id), { cache: 'no-store' });
  const t = await r.text();
  if (!r.ok) { box.innerHTML = `<p class="note red">Could not read: ${esc(t)}</p>`; return; }
  n.base = (r.headers.get('ETag') || '').replace(/"/g, '');
  box.innerHTML = `<textarea id="ed" spellcheck="false" aria-label="File text"></textarea>
    <div class="row"><button data-act="save">Save</button><button data-act="cancel">Cancel</button></div>
    <p id="edmsg" class="note">Save writes ${esc(n.rel)} and makes one local commit. Cmd+S also saves.</p>`;
  $('#ed').value = t; $('#ed').focus();
}
async function saveEdit(n) {
  msg('Saving…');
  const res = await api('/api/update', { id: n.id, text: $('#ed').value, base: n.base });
  if (res.ok) return done(res, res.data.unchanged ? 'No change to' : 'Saved');
  msg(res.code === 409 ? 'Not saved: the file changed on disk since you opened it. Copy your text, press Cancel, then Edit again.' : 'Not saved: ' + res.text, true);
}
function askArchive(n) {
  $('#filebox').innerHTML = `<div class="nf">
    <label for="ar-why">Reason (required)</label><input id="ar-why" placeholder="Why this file is no longer current">
    <label for="ar-new">Replacement (optional)</label><input id="ar-new" placeholder="Path or id of the file that replaces it">
    <div class="row"><button data-act="do-archive">Confirm Archive</button><button data-act="cancel">Cancel</button></div>
    <p id="edmsg" class="note">Moves ${esc(n.rel)} to archive/${esc(n.rel)} and adds a line to archive/README.md. Nothing is deleted.</p></div>`;
  $('#ar-why').focus();
}
async function doArchive(n) {
  const reason = $('#ar-why').value.trim();
  if (!reason) return msg('Give a reason first.', true);
  msg('Archiving…');
  const res = await api('/api/archive', { id: n.id, reason, replacement: $('#ar-new').value.trim() });
  if (res.ok) return done(res, 'Archived');
  msg('Not archived: ' + res.text, true);
}
const FOLDERS = [['records', 'Record'], ['threads', 'Thread'], ['artifacts', 'Artifact'], ['handoffs', 'Handoff'], ['projects', 'Project'], ['policies', 'Policy'], ['prompts', 'Prompt'], ['schemas', 'Schema'], ['global', 'Global']];
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '');
function openNew(project) {
  if (!leaveOk()) return;
  S.selected = null; S.tplTouched = false;
  showCard(`<h3 id="card-title">New File</h3><div class="nf">
    <label for="nf-top">Folder <i class="tip" data-tip="Top folder in the repo. It sets the colour: records, threads, artifacts and so on.">i</i></label>
    <select id="nf-top">${FOLDERS.map(f => `<option value="${f[0]}">${f[1]} (${f[0]}/)</option>`).join('')}</select>
    <label for="nf-proj">Project <i class="tip" data-tip="Written to the project: field. It sets the area. Pick one or type a new name.">i</i></label>
    <input id="nf-proj" list="nf-projects" value="${esc(project)}"><datalist id="nf-projects">${S.areas.map(a => `<option value="${esc(a.area)}">`).join('')}</datalist>
    <label for="nf-name">File Name</label><input id="nf-name" placeholder="short-name">
    <label for="nf-title">Title</label><input id="nf-title" placeholder="What this memory is">
    <label for="nf-ext">Format</label><select id="nf-ext"><option value=".md">Markdown (.md)</option><option value=".yaml">YAML (.yaml)</option></select>
    <div class="path" id="nf-path"></div>
    <textarea id="ed" spellcheck="false" aria-label="File text"></textarea>
    <div class="row"><button data-act="create">Create</button><button data-act="cancel-new">Cancel</button></div>
    <p id="edmsg" class="note">Create writes the file and makes one local commit. Nothing is pushed.</p></div>`);
  newPreview(); $('#nf-name').focus();
}
function newPath() {
  const top = $('#nf-top').value, proj = slugify($('#nf-proj').value) || 'general';
  const name = slugify($('#nf-name').value) || 'untitled', ext = $('#nf-ext').value;
  const date = new Date().toISOString().slice(0, 10);
  if (['policies', 'prompts', 'schemas', 'global'].includes(top)) return `${top}/${name}${ext}`;
  if (top === 'projects') return `projects/${proj}/${name}${ext}`;
  return `${top}/${proj}/${date}-${name}${ext}`;
}
function newPreview() {
  const rel = newPath(), proj = slugify($('#nf-proj').value) || 'general', title = $('#nf-title').value.trim() || 'Untitled';
  const id = rel.split('/').pop().replace(/\.(md|ya?ml)$/, ''), now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  $('#nf-path').textContent = rel;
  if (S.tplTouched) return;
  $('#ed').value = rel.endsWith('.md')
    ? `---\nid: ${id}\nproject: ${proj}\nstatus: active\ncreated_at: ${now}\nrelated: []\n---\n\n# ${title}\n\n`
    : `id: ${id}\nproject: ${proj}\nstatus: active\ncreated_at: ${now}\nsummary: >\n  ${title}\nrelated: []\n`;
}
async function doCreate() {
  if (!slugify($('#nf-name').value)) return msg('Give a file name first.', true);
  msg('Creating…');
  const res = await api('/api/create', { rel: newPath(), text: $('#ed').value });
  if (res.ok) return done(res, 'Created');
  msg('Not created: ' + res.text, true);
}

// ---------- hash (so Back closes a card and restores the view) ----------
function readHash() { return Object.fromEntries(new URLSearchParams(location.hash.slice(1))); }
function writeHash(push = false) {
  const p = new URLSearchParams({ view: S.view }); if (S.selected) p.set('node', S.selected.id);
  const h = '#' + p.toString(); if (h === location.hash) return;
  push ? history.pushState(null, '', h) : history.replaceState(null, '', h);
}
window.addEventListener('popstate', () => {
  if (S.dirty && !confirm('Discard unsaved changes?')) { writeHash(true); return; }
  S.dirty = false;
  const h = readHash();
  if (h.view && h.view !== S.view) setView(h.view);
  if (h.node && S.byId.has(h.node)) openCard(S.byId.get(h.node), false); else closeCard(false);
});

// ---------- events ----------
function setType(t) {
  S.typeOnly = t;
  document.querySelectorAll('#types li').forEach(li => li.classList.toggle('off', !!t && li.dataset.type !== t));
  chipState();
}
$('#chips').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  if (c.dataset.kind) return setType(S.typeOnly === c.dataset.kind ? null : c.dataset.kind);
  S.areaOnly = S.areaOnly === c.dataset.area || !c.dataset.area ? '' : c.dataset.area; $('#area').value = S.areaOnly; chipState();
});
document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => { setView(b.dataset.view); setTimeout(fit, CONFIG.morphMs); }));
$('#types').addEventListener('click', e => { const li = e.target.closest('li'); if (li) setType(S.typeOnly === li.dataset.type ? null : li.dataset.type); });
$('#area').addEventListener('change', e => { S.areaOnly = e.target.value; chipState(); fit(); });
$('#names').addEventListener('click', e => { S.names = !S.names; e.currentTarget.setAttribute('aria-pressed', S.names); });
$('#motion').addEventListener('click', e => { S.motion = !S.motion; e.currentTarget.setAttribute('aria-pressed', S.motion); if (!S.motion) S.spin = 0; });
$('#fit').addEventListener('click', () => fit());
$('#full').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
$('#shade').addEventListener('click', () => closeCard());
$('#card-x').addEventListener('click', () => closeCard());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#hits').hidden) { $('#hits').hidden = true; return; } closeCard(); }
});
$('#card-body').addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { const n = S.byId.get(go.dataset.go); if (n) { flyTo(n); openCard(n); } return; }
  const act = e.target.closest('[data-act]')?.dataset.act, n = S.selected;
  if (!act || !n) return;
  if (act === 'fly') flyTo(n);
  if (act === 'copy') navigator.clipboard.writeText(n.path).then(() => { e.target.textContent = 'Copied'; });
  if (act === 'open') openFile(n);
  if (act === 'edit') openEditor(n);
  if (act === 'archive') askArchive(n);
  if (act === 'new') openNew(n.kind === 'area' ? n.area : '');
  if (act === 'save') saveEdit(n);
  if (act === 'do-archive') doArchive(n);
  if (act === 'cancel') { S.dirty = false; openCard(n, false); }
});
$('#card-body').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'create') doCreate();
  if (act === 'cancel-new') { S.dirty = false; closeCard(); }
});
$('#card-body').addEventListener('input', e => {
  if (e.target.id === 'ed') { S.dirty = true; if ($('#nf-top')) S.tplTouched = true; }
  if (e.target.closest('.nf') && e.target.id !== 'ed') newPreview();
});
$('#card-body').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && e.target.id === 'ed') {
    e.preventDefault(); if ($('#nf-top')) doCreate(); else if (S.selected) saveEdit(S.selected);
  }
});
$('#new').addEventListener('click', () => openNew(S.areaOnly || ''));
document.querySelectorAll('.stat').forEach(b => b.addEventListener('click', e => {
  if (e.target.classList.contains('tip')) return;
  const k = b.dataset.stat, row = n => `<li data-go="${esc(n.id)}"><span class="dot" data-c="${COLOR[n.kind] || COLOR.other}"></span>${esc(n.name)}<small>${esc(n.area)}</small></li>`;
  if (k === 'areas') { setView('areas'); setTimeout(fit, CONFIG.morphMs); }
  if (k === 'links') { setView('links'); setTimeout(fit, CONFIG.morphMs); }
  if (k === 'memories') openList('All Memories', [...S.mems].sort((a, b) => a.name.localeCompare(b.name)).map(row), 'Every memory file, A to Z. Click one to open it.');
  if (k === 'unresolved') openList('Unresolved Links', S.graph.unresolved.map(u => { const n = S.byId.get(u.from); return `<li data-go="${esc(u.from)}">[[${esc(u.target)}]]<small>in ${esc(n ? n.name : u.from)}</small></li>`; }), 'Links to a memory that does not exist yet. Click to open the file that holds the link.');
  if (k === 'git') { const G = S.session?.git || {}; openList('Not Pushed', [`<li>${G.ahead ?? 'Unknown'} local commits on ${esc(G.branch || '?')} that GitHub does not have</li>`, `<li><code>git -C ${esc(S.session?.repo || '~/JMacAIUnifiedMemory')} push</code></li>`], 'The Brain View commits each change locally and never pushes. Review, then run the push command in a terminal.'); }
  if (k === 'built') { const R = S.graph.repo || {}; openList('Source', [R.url && `<li><a href="${esc(R.url)}" target="_blank" rel="noopener noreferrer">${esc(R.url)}</a></li>`, R.branch && `<li>Branch ${esc(R.branch)} · Commit ${esc(R.commit)}</li>`, ...S.graph.sources.map(s => `<li>${esc(s)}</li>`)].filter(Boolean), `graph.json built ${S.graph.built} from this repo by build_graph.py. Pull the repo, then rebuild: python3 brain/build_graph.py`); }
}));

// search
let hitList = [], hitOn = 0;
$('#q').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase(), box = $('#hits');
  if (!q) { box.hidden = true; return; }
  hitList = S.nodes.filter(n => (n.name + ' ' + n.description + ' ' + n.path).toLowerCase().includes(q)).slice(0, 30);
  hitOn = 0;
  box.innerHTML = hitList.length ? hitList.map((n, i) => `<li data-i="${i}" class="${i ? '' : 'on'}">${esc(n.name)}<small>${LABEL[n.kind] || n.kind} · ${esc(n.area)}</small></li>`).join('') : '<li>No match</li>';
  box.hidden = false;
});
$('#q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { hitOn = (hitOn + (e.key === 'ArrowDown' ? 1 : -1) + hitList.length) % Math.max(hitList.length, 1); document.querySelectorAll('#hits li').forEach((li, i) => li.classList.toggle('on', i === hitOn)); e.preventDefault(); }
  if (e.key === 'Enter' && hitList[hitOn]) pick(hitList[hitOn]);
});
$('#hits').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pick(hitList[+li.dataset.i]); });
function pick(n) { $('#hits').hidden = true; flyTo(n); openCard(n); }

// pan, zoom, hover, click
let drag = null;
canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y, yaw: S.yaw, pitch: S.pitch, moved: false }; });
window.addEventListener('mouseup', e => {
  if (drag && !drag.moved && e.target === canvas) {
    const r = canvas.getBoundingClientRect(), n = S.badge ? null : hit(e.clientX - r.left, e.clientY - r.top);
    if (S.badge) setType(S.typeOnly === S.badge.kind ? null : S.badge.kind); else if (n) openCard(n);
  }
  drag = null; canvas.classList.remove('drag');
});
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; canvas.classList.add('drag'); S.fly = null; }
    if (S.view === 'orbit') { S.yaw = drag.yaw + dx * CONFIG.orbitDragRad; S.pitch = Math.max(-1.2, Math.min(1.2, drag.pitch + dy * CONFIG.orbitDragRad)); }
    else { S.cam.x = drag.cx - dx / S.cam.k; S.cam.y = drag.cy - dy / S.cam.k; }
    return;
  }
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  S.badge = S.view === 'orbit' ? S.badges.find(b => Math.hypot(b.x - mx, b.y - my) < b.r) || null : null;  // a badge wins over a dot under it
  S.hover = S.badge ? null : hit(mx, my);
  canvas.classList.toggle('over', !!(S.hover || S.badge));
  canvas.title = S.badge ? `${LABEL[S.badge.kind]} files: ${S.mems.filter(n => n.kind === S.badge.kind).length}\nDrawn as ${GLYPH[SHAPE[S.badge.kind]]}. Click to show only this kind; click again for all.` : S.hover ? `${S.hover.name}\n${LABEL[S.hover.kind] || S.hover.kind}${S.hover.area ? ' · ' + S.hover.area : ''}\n${S.hover.description || ''}` : '';
});
canvas.addEventListener('mouseleave', () => { S.hover = null; S.badge = null; });
canvas.addEventListener('wheel', e => {
  e.preventDefault(); S.fly = null;
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
  const k = Math.min(12, Math.max(0.05, S.cam.k * Math.exp(-e.deltaY * 0.0015)));
  S.cam.x += mx / S.cam.k - mx / k; S.cam.y += my / S.cam.k - my / k; S.cam.k = k;
}, { passive: false });

// (i) tips
const tipbox = $('#tipbox');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tipbox.hidden = true; return; }
  tipbox.textContent = t.dataset.tip; tipbox.hidden = false;
  const b = t.getBoundingClientRect();
  tipbox.style.left = Math.min(b.left, innerWidth - 320) + 'px'; tipbox.style.top = (b.bottom + 6) + 'px';
});

function status(msg, bad) { const s = $('#status'); s.textContent = msg; s.classList.toggle('red', !!bad); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

new ResizeObserver(resize).observe(canvas);
resize();
load();
