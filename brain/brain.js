// Brain View: draws data/graph.json four ways on one canvas. Reads only.
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
};

const TYPES = [
  ['user', '#f0b429', 'User'], ['feedback', '#ef5b5b', 'Feedback'], ['project', '#6ea8fe', 'Project'],
  ['reference', '#3ecf8e', 'Reference'], ['decision', '#c792ea', 'Decision'], ['other', '#8a93a6', 'Other'],
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
};

// ---------- data ----------
async function load() {
  let g;
  try {
    const r = await fetch('/graph.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(await r.text());
    g = await r.json();
  } catch (e) {
    status('Could not read graph.json: ' + e.message, true);
    return;
  }
  S.graph = g;
  S.nodes = g.nodes.map(n => ({ ...n, x: 0, y: 0, tx: 0, ty: 0, deg: 0 }));
  S.nodes.forEach(n => { S.byId.set(n.id, n); S.out.set(n.id, []); S.inn.set(n.id, []); });
  S.edges = g.edges.filter(e => S.byId.has(e.from) && S.byId.has(e.to)).map(e => ({ a: S.byId.get(e.from), b: S.byId.get(e.to), why: e.why }));
  S.edges.forEach(e => { e.a.deg++; e.b.deg++; S.out.get(e.a.id).push(e); S.inn.get(e.b.id).push(e); });
  S.nodes.forEach(n => { n.r = n.kind === 'root' ? 14 : n.kind === 'area' ? 7 : 3 + Math.sqrt(n.deg) * 1.2; });
  S.mems = S.nodes.filter(isMem);
  S.areas = S.nodes.filter(n => n.kind === 'area').sort((a, b) => a.name.localeCompare(b.name));
  fillChrome();
  const h = readHash();
  setView(h.view || 'rings', false);
  fit(false);
  if (h.node && S.byId.has(h.node)) openCard(S.byId.get(h.node), false);
  status(`${S.mems.length} memories · ${S.areas.length} areas · built ${g.built}`);
  requestAnimationFrame(frame);
}
const isMem = n => n.kind !== 'root' && n.kind !== 'area';

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
  $('#area').insertAdjacentHTML('beforeend', S.areas.map(a => `<option value="${esc(a.area)}">${esc(a.name)} (${S.out.get(a.id).length})</option>`).join(''));
}

// ---------- layouts ----------
function layout(view) {
  if (S.layouts[view]) return S.layouts[view];
  const L = new Map();
  if (view === 'rings') {
    const order = ['user', 'feedback', 'project', 'reference', 'decision', 'other'];
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
    const times = S.mems.map(n => Date.parse(n.modified)).filter(Number.isFinite);
    const lo = Math.min(...times), hi = Math.max(...times), span = Math.max(hi - lo, 864e5);
    const lanes = TYPES.map(t => t[0]).filter(k => S.mems.some(n => n.kind === k));
    const W = CONFIG.timelineWidth;
    S.timeline = { lo, hi, span, lanes, W };
    const jitter = new Map();
    S.mems.forEach(n => {
      const t = Date.parse(n.modified), x = Number.isFinite(t) ? (t - lo) / span * W - W / 2 : -W / 2 - 60;
      const lane = lanes.indexOf(n.kind), key = n.kind + Math.round(x / 6);
      const k = jitter.get(key) || 0; jitter.set(key, k + 1);
      L.set(n.id, [x, (lane - (lanes.length - 1) / 2) * CONFIG.laneGap + ((k % 7) - 3) * 7]);
    });
  }
  S.layouts[view] = L;
  return L;
}

function setView(view, animate = true) {
  S.view = view;
  document.querySelectorAll('.views button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const L = layout(view);
  S.nodes.forEach(n => { const p = L.get(n.id); n.hidden = !p; if (p) { n.tx = p[0]; n.ty = p[1]; } });
  if (!animate) S.nodes.forEach(n => { n.x = n.tx; n.y = n.ty; });
  else { S.nodes.forEach(n => { n.fx = n.x; n.fy = n.y; }); S.anim = { t0: performance.now() }; }
  S.spin = 0;
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
  draw();
}
function draw() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  if (S.view === 'timeline') drawAxis(r);
  const focus = S.hover || S.selected, near = focus ? neighbours(focus) : null;
  ctx.lineWidth = 1;
  for (const e of S.edges) {
    if (!visible(e.a) || !visible(e.b)) continue;
    if (S.view === 'timeline' && e.why !== 'link') continue;
    const lit = focus && (e.a === focus || e.b === focus);
    if (focus && !lit && S.view !== 'links' && e.why === 'area') continue;
    const [x1, y1] = toScreen(e.a.x, e.a.y), [x2, y2] = toScreen(e.b.x, e.b.y);
    ctx.strokeStyle = lit ? 'rgba(110,168,254,.9)' : e.why === 'link' ? `rgba(199,146,234,${focus ? .08 : .35})` : `rgba(140,150,170,${focus ? .03 : .09})`;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  const showAll = S.names || S.cam.k >= CONFIG.labelZoom;
  ctx.font = '11px -apple-system, sans-serif';
  for (const n of S.nodes) {
    if (!visible(n)) continue;
    const [x, y] = toScreen(n.x, n.y), rad = n.r * Math.max(0.6, Math.min(S.cam.k, 2.5));
    if (x < -40 || y < -40 || x > r.width + 40 || y > r.height + 40) continue;
    ctx.globalAlpha = near && !near.has(n.id) ? 0.12 : 1;
    ctx.fillStyle = COLOR[n.kind] || COLOR.other;
    ctx.beginPath();
    if (n.kind === 'area') ctx.rect(x - rad, y - rad, rad * 2, rad * 2);
    else ctx.arc(x, y, rad, 0, 2 * Math.PI);
    ctx.fill();
    if (n.kind === 'root' || n === S.selected) { ctx.strokeStyle = '#6ea8fe'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    const label = n.kind === 'root' || (n.kind === 'area' && S.view === 'areas') || showAll || (near && near.has(n.id));
    if (label) { ctx.fillStyle = '#e6e9ef'; ctx.fillText(n.name, x + rad + 3, y + 4); }
  }
  ctx.globalAlpha = 1;
}
function drawAxis(r) {
  const T = S.timeline; if (!T) return;
  ctx.fillStyle = '#8a93a6'; ctx.strokeStyle = 'rgba(140,150,170,.15)'; ctx.font = '11px -apple-system, sans-serif';
  T.lanes.forEach((k, i) => { const [x, y] = toScreen(-T.W / 2 - 20, (i - (T.lanes.length - 1) / 2) * CONFIG.laneGap); ctx.fillText(LABEL[k], Math.max(4, x - 70), y + 4); });
  const d = new Date(T.lo); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  const step = T.span > 400 * 864e5 ? 3 : 1;
  while (d.getTime() <= T.hi) {
    const x0 = (d.getTime() - T.lo) / T.span * T.W - T.W / 2;
    const [x] = toScreen(x0, 0);
    if (x > 0 && x < r.width) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, r.height); ctx.stroke(); ctx.fillText(d.toISOString().slice(0, 7), x + 3, 14); }
    d.setUTCMonth(d.getUTCMonth() + step);
  }
}

// ---------- camera ----------
function fit(animate = true) {
  const vis = S.nodes.filter(visible); if (!vis.length) return;
  const xs = vis.map(n => n.tx), ys = vis.map(n => n.ty), r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) { requestAnimationFrame(() => fit(animate)); return; }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min(r.width / (maxX - minX + 80), r.height / (maxY - minY + 80), 3);
  go((minX + maxX) / 2, (minY + maxY) / 2, k, animate);
}
function go(x, y, k, animate = true) {
  S.spin = 0;
  if (!animate) { S.cam = { x, y, k }; return; }
  S.fly = { t0: performance.now(), x0: S.cam.x, y0: S.cam.y, k0: S.cam.k, x1: x, y1: y, k1: k };
}
function flyTo(n) {
  if (S.areaOnly && n.area !== S.areaOnly) { S.areaOnly = ''; $('#area').value = ''; }
  if (S.typeOnly && isMem(n) && n.kind !== S.typeOnly) setType(null);
  go(n.tx, n.ty, Math.max(S.cam.k, CONFIG.flyZoom));
}
function hit(mx, my) {
  let best = null, bd = Infinity;
  for (const n of S.nodes) {
    if (!visible(n)) continue;
    const [x, y] = toScreen(n.x, n.y), d = Math.hypot(x - mx, y - my), lim = Math.max(CONFIG.hitPx, n.r * S.cam.k);
    if (d < lim && d < bd) { bd = d; best = n; }
  }
  return best;
}

// ---------- card ----------
function openCard(n, push = true) {
  S.selected = n;
  const outL = S.out.get(n.id), inL = S.inn.get(n.id);
  const item = e => { const m = e; return `<li data-go="${esc(m.id)}"><span class="dot" data-c="${COLOR[m.kind] || COLOR.other}"></span>${esc(m.name)}<small>${LABEL[m.kind] || m.kind}${m.area && m.kind !== 'area' ? ' · ' + esc(m.area) : ''}</small></li>`; };
  const list = (title, arr, tip) => arr.length ? `<h4>${title} (${arr.length}) <i class="tip" data-tip="${tip}">i</i></h4><ul>${arr.map(item).join('')}</ul>` : '';
  const unres = S.graph.unresolved.filter(u => u.from === n.id);
  let html = `<h3 id="card-title">${esc(n.name)}</h3>
    <div class="meta">${LABEL[n.kind] || n.kind}${n.area && n.kind !== 'area' ? ' · Area ' + esc(n.area) : ''}${n.modified ? ' · Changed ' + esc(n.modified.slice(0, 10)) : ''} · ${n.deg} links</div>
    <p class="desc">${esc(n.description || '')}</p>`;
  if (n.path) html += `<div class="path">${esc(n.path)}</div>`;
  html += `<div class="row"><button data-act="fly">Fly To</button>${n.path ? '<button data-act="copy">Copy Path</button>' : ''}${isMem(n) ? '<button data-act="open">Open File</button>' : ''}</div><div id="filebox"></div>`;
  if (n.kind === 'root') html += list('Areas', outL.map(e => e.b), 'Every memory folder read by build_graph.py.');
  else if (n.kind === 'area') html += list('Memories', outL.map(e => e.b).sort((a, b) => a.name.localeCompare(b.name)), 'Every memory file in this folder.');
  else {
    html += list('Links Out', outL.filter(e => e.why === 'link').map(e => e.b), 'Memories this file names with [[name]].');
    html += list('Links In', inL.filter(e => e.why === 'link').map(e => e.a), 'Memories that name this file with [[name]].');
    if (unres.length) html += `<h4>Unresolved (${unres.length}) <i class="tip" data-tip="[[name]] links in this file with no matching memory yet.">i</i></h4><ul>${unres.map(u => `<li>${esc(u.target)}</li>`).join('')}</ul>`;
    html += `<p class="note">Read only. Edit this memory in its file or through the Memory OS tools; the next build picks it up.</p>`;
  }
  showCard(html);
  if (push) writeHash(true);
}
function openList(title, items, tip) {
  S.selected = null;
  showCard(`<h3 id="card-title">${esc(title)}</h3><p class="note">${esc(tip)}</p><ul>${items.join('')}</ul>`);
}
function showCard(html) {
  $('#card-body').innerHTML = html;
  $('#card-body').querySelectorAll('.dot[data-c]').forEach(d => { d.style.background = d.dataset.c; });
  $('#card').hidden = false; $('#shade').hidden = false;
  $('#card-x').focus();
}
function closeCard(push = true) {
  if ($('#card').hidden) return;
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

// ---------- hash (so Back closes a card and restores the view) ----------
function readHash() { return Object.fromEntries(new URLSearchParams(location.hash.slice(1))); }
function writeHash(push = false) {
  const p = new URLSearchParams({ view: S.view }); if (S.selected) p.set('node', S.selected.id);
  const h = '#' + p.toString(); if (h === location.hash) return;
  push ? history.pushState(null, '', h) : history.replaceState(null, '', h);
}
window.addEventListener('popstate', () => {
  const h = readHash();
  if (h.view && h.view !== S.view) setView(h.view);
  if (h.node && S.byId.has(h.node)) openCard(S.byId.get(h.node), false); else closeCard(false);
});

// ---------- events ----------
function setType(t) {
  S.typeOnly = t;
  document.querySelectorAll('#types li').forEach(li => li.classList.toggle('off', !!t && li.dataset.type !== t));
}
document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => { setView(b.dataset.view); setTimeout(fit, CONFIG.morphMs); }));
$('#types').addEventListener('click', e => { const li = e.target.closest('li'); if (li) setType(S.typeOnly === li.dataset.type ? null : li.dataset.type); });
$('#area').addEventListener('change', e => { S.areaOnly = e.target.value; fit(); });
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
});
document.querySelectorAll('.stat').forEach(b => b.addEventListener('click', e => {
  if (e.target.classList.contains('tip')) return;
  const k = b.dataset.stat, row = n => `<li data-go="${esc(n.id)}"><span class="dot" data-c="${COLOR[n.kind] || COLOR.other}"></span>${esc(n.name)}<small>${esc(n.area)}</small></li>`;
  if (k === 'areas') { setView('areas'); setTimeout(fit, CONFIG.morphMs); }
  if (k === 'links') { setView('links'); setTimeout(fit, CONFIG.morphMs); }
  if (k === 'memories') openList('All Memories', [...S.mems].sort((a, b) => a.name.localeCompare(b.name)).map(row), 'Every memory file, A to Z. Click one to open it.');
  if (k === 'unresolved') openList('Unresolved Links', S.graph.unresolved.map(u => { const n = S.byId.get(u.from); return `<li data-go="${esc(u.from)}">[[${esc(u.target)}]]<small>in ${esc(n ? n.name : u.from)}</small></li>`; }), 'Links to a memory that does not exist yet. Click to open the file that holds the link.');
  if (k === 'built') openList('Sources', S.graph.sources.map(s => `<li>${esc(s)}</li>`), `graph.json built ${S.graph.built} from these folders by build_graph.py. Rebuild: python3 brain/build_graph.py`);
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
canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y, moved: false }; });
window.addEventListener('mouseup', e => {
  if (drag && !drag.moved) { const r = canvas.getBoundingClientRect(), n = hit(e.clientX - r.left, e.clientY - r.top); if (n && e.target === canvas) openCard(n); }
  drag = null; canvas.classList.remove('drag');
});
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; canvas.classList.add('drag'); S.fly = null; }
    S.cam.x = drag.cx - dx / S.cam.k; S.cam.y = drag.cy - dy / S.cam.k;
    return;
  }
  S.hover = hit(e.clientX - r.left, e.clientY - r.top);
  canvas.classList.toggle('over', !!S.hover);
  canvas.title = S.hover ? `${S.hover.name}\n${LABEL[S.hover.kind] || S.hover.kind}${S.hover.area ? ' · ' + S.hover.area : ''}\n${S.hover.description || ''}` : '';
});
canvas.addEventListener('mouseleave', () => { S.hover = null; });
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
