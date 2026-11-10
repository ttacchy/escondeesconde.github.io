(() => {
'use strict';
const { C, PROPS, MAPS, moveCircle } = window.GameShared;
const $ = id => document.getElementById(id);
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const cv = $('cv'), ctx = cv.getContext('2d');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let net = null, myId = null, room = null, game = null, leaving = false, raf = 0;

/* ============ utilidades ============ */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}
const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const hue = id => (id * 67 + 20) % 360;
function setText(el, v) { if (el.textContent !== v) el.textContent = v; }

/* ============ áudio (sintetizado) ============ */
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* sem áudio */ } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(f, d = 0.12, type = 'sine', v = 0.08, delay = 0, slide = 0) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + 0.03);
}
const SFX = {
  found() { [523, 659, 784].forEach((f, i) => tone(f, .14, 'triangle', .1, i * .09)); },
  stun() { tone(190, .35, 'sawtooth', .08, 0, -110); },
  sonar() { tone(900, .55, 'sine', .08, 0, -520); },
  go() { [392, 523, 659, 784].forEach((f, i) => tone(f, .16, 'square', .05, i * .08)); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .2, 'triangle', .1, i * .12)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, .25, 'sawtooth', .06, i * .15)); },
  tick() { tone(1000, .05, 'square', .035); },
  copy() { tone(600, .1, 'triangle', .07, 0, 300); }
};

/* ============ rede ============ */
// Sem servidor: quem cria a sala vira o "host" (a partida roda no navegador dele)
// e os outros jogadores conectam direto nele por WebRTC (PeerJS).
const PEER_PREFIX = 'esconde-esconde-';
const send = o => {
  if (!net) return;
  if (net.isHost) net.engine.onMessage(1, o);
  else if (net.conn && net.conn.open) net.conn.send(o);
};
function netClose() {
  const n = net; net = null;
  if (!n) return;
  try { if (n.engine) n.engine.stop(); if (n.peer) n.peer.destroy(); } catch (e) { /* ignorar */ }
}
function backToMenu(msg) {
  stopGame(); room = null;
  $('end').classList.remove('show'); show('menu');
  if (msg) toast(msg);
}
function randCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c = '';
  for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)];
  return c;
}

function hostRoom(name) {
  if (net) return;
  if (typeof Peer === 'undefined') return toast('Biblioteca de rede não carregou. Recarregue a página.');
  net = { isHost: true, engine: null, peer: null, conn: null };
  toast('Criando sala…');
  const attempt = n => {
    const code = randCode();
    const peer = new Peer(PEER_PREFIX + code, { debug: 0 });
    net.peer = peer;
    peer.on('open', () => {
      const engine = HostEngine.create({ code });
      net.engine = engine; myId = 1;
      peer.on('connection', conn => {
        const id = engine.nextId();
        conn.on('data', m => {
          if (m && m.t === 'join') {
            const ok = engine.addPlayer(id, o => { if (conn.open) conn.send(o); }, m.name);
            if (!ok) setTimeout(() => conn.close(), 300);
          } else engine.onMessage(id, m);
        });
        conn.on('open', () => conn.send({ t: 'hello', id }));
        conn.on('close', () => engine.removePlayer(id));
      });
      onMsg({ t: 'hello', id: 1 });
      engine.addPlayer(1, onMsg, name);
      engine.start();
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignorar */ } });
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && n < 6) { peer.destroy(); attempt(n + 1); return; }
      if (err.type === 'disconnected' || err.type === 'network') return;
      netClose(); backToMenu('Não foi possível criar a sala (' + err.type + ').');
    });
  };
  attempt(0);
}

function joinRoom(name, code) {
  if (net) return;
  if (typeof Peer === 'undefined') return toast('Biblioteca de rede não carregou. Recarregue a página.');
  const peer = new Peer({ debug: 0 });
  net = { isHost: false, engine: null, peer, conn: null };
  let opened = false;
  const fail = msg => { netClose(); backToMenu(msg); };
  const timer = setTimeout(() => { if (!opened) fail('Não foi possível conectar. Confira o código e se o anfitrião está com a página aberta.'); }, 12000);
  toast('Conectando…');
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + code, { serialization: 'json', reliable: true });
    net.conn = conn;
    conn.on('open', () => { opened = true; clearTimeout(timer); conn.send({ t: 'join', name }); });
    conn.on('data', onMsg);
    conn.on('close', () => { if (net) { const had = !!room; netClose(); backToMenu(had && !leaving ? 'O anfitrião saiu da sala.' : null); } });
  });
  peer.on('error', err => {
    clearTimeout(timer);
    fail(err.type === 'peer-unavailable' ? 'Sala não encontrada.' : 'Erro de conexão (' + err.type + ').');
  });
}

function onMsg(m) {
  switch (m.t) {
    case 'hello': myId = m.id; break;
    case 'room':
      room = m;
      if (m.state === 'lobby') {
        if (!$('end').classList.contains('show')) { stopGame(); show('lobby'); }
        renderLobby();
      }
      break;
    case 'start': startGame(m.mapId); break;
    case 's': if (game) onSnap(m); break;
    case 'ev': if (game) onEvent(m); break;
    case 'end': if (game) showEnd(m); break;
    case 'err': if (room) toast(m.m); else { netClose(); backToMenu(m.m); } break;
  }
}

/* ============ sprites e cenário ============ */
const sprites = {};
function sprite(t) {
  if (sprites[t]) return sprites[t];
  const r = PROPS[t].r, s = Math.ceil(r * 2 + 10);
  const c = document.createElement('canvas'); c.width = c.height = s * 2;
  const g = c.getContext('2d');
  g.font = Math.round(r * 1.9 * 2) + 'px ' + EMOJI; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(PROPS[t].e, s, s + 2);
  return (sprites[t] = { c, s });
}
function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawPattern(g, map) {
  const { w, h } = map; g.save();
  g.strokeStyle = 'rgba(0,0,0,.09)'; g.lineWidth = 2;
  if (map.pattern === 'wood') {
    for (let y = 0; y < h; y += 36) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  } else if (map.pattern === 'tiles' || map.pattern === 'concrete') {
    const s = map.pattern === 'tiles' ? 60 : 120;
    for (let x = 0; x < w; x += s) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += s) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }
  if (map.pattern === 'grass' || map.pattern === 'concrete') {
    let a = 12345; const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    const n = Math.floor(w * h / 450);
    for (let i = 0; i < n; i++) {
      g.fillStyle = rnd() < .5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)';
      g.fillRect(rnd() * w, rnd() * h, 3, 3);
    }
  }
  g.restore();
}
function drawWall(g, w) {
  if (w.s !== 'water') { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(w.x + 4, w.y + 6, w.w, w.h); }
  if (w.s === 'water') {
    g.fillStyle = '#3d8fd1'; rr(g, w.x, w.y, w.w, w.h, 40); g.fill();
    g.strokeStyle = '#2b6aa3'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { const x = w.x + 50 + (i * 67) % (w.w - 120), y = w.y + 40 + (i * 53) % (w.h - 80); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 15, y - 8, x + 30, y); g.stroke(); }
  } else if (w.s === 'hedge') {
    g.fillStyle = '#2e6b32'; rr(g, w.x, w.y, w.w, w.h, 10); g.fill();
    g.strokeStyle = '#1f4d24'; g.lineWidth = 3; g.stroke();
    g.fillStyle = 'rgba(120,200,90,.35)';
    for (let i = 0; i < (w.w * w.h) / 500; i++) g.fillRect(w.x + ((i * 37) % w.w), w.y + ((i * 53) % w.h), 3, 3);
  } else if (w.s === 'shelf') {
    g.fillStyle = '#8a5a2b'; g.fillRect(w.x, w.y, w.w, w.h);
    g.fillStyle = '#c28a4a'; g.fillRect(w.x, w.y, w.w, 5);
    g.strokeStyle = '#5b3a1a'; g.lineWidth = 2;
    if (w.w >= w.h) for (let x = w.x + 40; x < w.x + w.w; x += 40) { g.beginPath(); g.moveTo(x, w.y); g.lineTo(x, w.y + w.h); g.stroke(); }
    g.strokeRect(w.x, w.y, w.w, w.h);
  } else {
    g.fillStyle = '#3a3f4c'; g.fillRect(w.x, w.y, w.w, w.h);
    g.fillStyle = '#5a6174'; g.fillRect(w.x, w.y, w.w, Math.min(5, w.h)); g.fillRect(w.x, w.y, Math.min(5, w.w), w.h);
  }
}
const layers = {};
function renderLayer(map, sc) {
  const c = document.createElement('canvas'); c.width = Math.ceil(map.w * sc); c.height = Math.ceil(map.h * sc);
  const g = c.getContext('2d'); g.scale(sc, sc);
  g.fillStyle = map.floor; g.fillRect(0, 0, map.w, map.h);
  for (const z of map.zones) { g.fillStyle = z.c; g.fillRect(z.x, z.y, z.w, z.h); }
  drawPattern(g, map);
  g.fillStyle = 'rgba(0,0,0,.22)';
  for (const p of map.props) { const r = PROPS[p.t].r; g.beginPath(); g.ellipse(p.x, p.y + r * .75, r * .9, r * .38, 0, 0, 6.283); g.fill(); }
  for (const w of map.walls) drawWall(g, w);
  return c;
}
function drawPreview(map, canvas) {
  const W = (canvas.width = 260), H = (canvas.height = Math.round(260 * map.h / map.w)), sc = W / map.w;
  const g = canvas.getContext('2d');
  g.drawImage(renderLayer(map, sc), 0, 0);
  for (const p of map.props) {
    const sp = sprite(p.t), size = Math.max(4, sp.s * sc);
    g.drawImage(sp.c, p.x * sc - size / 2, p.y * sc - size / 2, size, size);
  }
}

/* ============ menu e lobby ============ */
const inName = $('inName'), inCode = $('inCode');
inName.value = localStorage.getItem('ee_name') || '';
if (location.hash.length >= 5) inCode.value = location.hash.slice(1, 5).toUpperCase();
function getName() {
  const n = inName.value.trim();
  if (!n) { toast('Digite seu nome primeiro.'); inName.focus(); return null; }
  localStorage.setItem('ee_name', n); return n;
}
$('btnCreate').onclick = () => { const n = getName(); if (!n) return; audio(); hostRoom(n); };
$('btnJoin').onclick = () => {
  const n = getName(); if (!n) return;
  const c = inCode.value.trim().toUpperCase();
  if (c.length !== 4) return toast('O código tem 4 letras.');
  audio(); joinRoom(n, c);
};
inCode.addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
inName.addEventListener('keydown', e => { if (e.key === 'Enter') (inCode.value ? $('btnJoin') : $('btnCreate')).click(); });

$('btnLeave').onclick = () => { leaving = true; netClose(); backToMenu(); leaving = false; };
$('btnCopy').onclick = () => {
  const link = location.origin + location.pathname + '#' + room.code;
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Link copiado! Envie para seus amigos.'), () => prompt('Copie o link:', link));
};
$('btnJoinHide').onclick = () => send({ t: 'team', team: 'hide' });
$('btnJoinSeek').onclick = () => send({ t: 'team', team: 'seek' });
$('btnStart').onclick = () => send({ t: 'start' });

let mapCardsBuilt = false;
function buildMapCards() {
  const grid = $('mapGrid');
  for (const m of MAPS) {
    const card = document.createElement('div'); card.className = 'map-card'; card.dataset.id = m.id;
    const cvs = document.createElement('canvas'); card.appendChild(cvs);
    card.insertAdjacentHTML('beforeend', `<b>${m.name}</b><span>${m.desc}</span>`);
    card.onclick = () => { if (room && room.host === myId) send({ t: 'map', id: m.id }); };
    grid.appendChild(card);
    drawPreview(m, cvs);
  }
  mapCardsBuilt = true;
}
function renderLobby() {
  if (!mapCardsBuilt) buildMapCards();
  setText($('lobCode'), room.code);
  const isHost = room.host === myId;
  for (const [id, ul] of [['hide', $('listHide')], ['seek', $('listSeek')]]) {
    ul.innerHTML = '';
    for (const p of room.players.filter(p => p.team === id)) {
      const li = document.createElement('li'); if (p.id === myId) li.className = 'me';
      const nm = document.createElement('span'); nm.textContent = p.name; li.appendChild(nm);
      const tag = document.createElement('span'); tag.className = 'tag';
      tag.textContent = (p.id === room.host ? '👑 anfitrião' : '') + (p.id === myId ? ' (você)' : ''); li.appendChild(tag);
      ul.appendChild(li);
    }
  }
  document.querySelectorAll('.map-card').forEach(c => c.classList.toggle('sel', c.dataset.id === room.mapId));
  $('mapGrid').classList.toggle('locked', !isHost);
  setText($('mapHint'), isHost ? '(clique para escolher)' : '(o anfitrião escolhe)');
  const nh = room.players.filter(p => p.team === 'hide').length, ns = room.players.length - nh;
  const ok = nh >= 1 && ns >= 1;
  $('btnStart').disabled = !isHost || !ok;
  setText($('lobHint'), !isHost ? 'Aguardando o anfitrião começar…' : ok ? '' : 'Precisa de 1+ jogador em cada equipe');
}

/* ============ jogo ============ */
function startGame(mapId) {
  const map = MAPS.find(m => m.id === mapId) || MAPS[0];
  if (!layers[map.id]) layers[map.id] = renderLayer(map, 1.25);
  game = {
    map, layer: layers[map.id], ents: new Map(), pred: null, team: 'hide', youKey: null,
    phase: 'hiding', tl: C.HIDE_TIME, tlAt: performance.now(), me: { mv: 1, sc: 0 }, counts: { h: 0, s: 0 },
    keys: {}, mouse: { sx: 0, sy: 0 }, sonar: null, fx: [], feed: [], lastSend: 0, lastSec: -1, zoom: 1, cam: { x: 0, y: 0, vw: 1, vh: 1 }
  };
  $('end').classList.remove('show');
  show('game'); resize(); $('feed').innerHTML = '';
  cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}
function stopGame() { cancelAnimationFrame(raf); game = null; }

function resize() {
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr);
  if (game) game.zoom = clamp(Math.min(innerWidth / 1000, innerHeight / 650), 0.75, 1.5);
}
addEventListener('resize', resize);

function onSnap(m) {
  const g = game;
  g.phase = m.ph; g.tl = m.tl; g.tlAt = performance.now(); g.me = m.me;
  g.counts = { h: m.hd.length, s: m.sk.length };
  const seen = new Set();
  const upd = (key, o) => {
    let e = g.ents.get(key);
    if (!e) { e = { key, x: o.x, y: o.y }; g.ents.set(key, e); }
    e.tx = o.x; e.ty = o.y; e.kind = o.kind; e.id = o.id; e.n = o.n; e.d = o.d; e.a = o.a || 0; e.stun = o.s; e.found = o.f;
    seen.add(key);
  };
  let youKey = null;
  for (const s of m.sk) { upd('s' + s.i, { ...s, id: s.i, kind: 'seek' }); if (s.i === myId) youKey = 's' + s.i; }
  for (const h of m.hd) { upd('h' + h.k, { ...h, id: h.i, kind: 'hide' }); if (h.i === myId) youKey = 'h' + h.k; }
  for (const k of [...g.ents.keys()]) if (!seen.has(k)) g.ents.delete(k);
  g.youKey = youKey;
  g.team = youKey && youKey[0] === 's' ? 'seek' : 'hide';
  const e = g.ents.get(youKey);
  if (e) {
    if (!g.pred) g.pred = { x: e.tx, y: e.ty };
    const dx = e.tx - g.pred.x, dy = e.ty - g.pred.y;
    if (!m.me.mv || Math.hypot(dx, dy) > 100) { g.pred.x = e.tx; g.pred.y = e.ty; }
    else { g.pred.x += dx * 0.12; g.pred.y += dy * 0.12; }
  }
}

function pushFeed(text, cls) {
  const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls;
  $('feed').appendChild(d); setTimeout(() => d.remove(), 7000);
  while ($('feed').children.length > 5) $('feed').firstChild.remove();
}
function onEvent(m) {
  switch (m.k) {
    case 'found':
      pushFeed('🔎 ' + m.by + ' encontrou ' + m.who + '!  (restam ' + m.left + ')', 'found'); SFX.found();
      if (m.whoId === myId) toast('Você foi encontrado! Agora você é caçador.');
      break;
    case 'stun': SFX.stun(); pushFeed('💫 Era só um objeto de verdade! Atordoado…', 'bad'); break;
    case 'sonar': game.sonar = { ang: m.ang, dist: m.dist, t0: performance.now() }; SFX.sonar(); break;
    case 'go': SFX.go(); pushFeed('🚨 A caçada começou! 5 minutos no relógio.'); break;
    case 'copy': SFX.copy(); break;
    case 'nocopy': toast('Chegue perto de um objeto para copiá-lo.'); break;
  }
}

function showEnd(m) {
  const mine = m.stats.find(s => s.id === myId);
  const won = mine ? mine.t0 === m.winner : false;
  const t = $('endTitle'); t.textContent = won ? '🏆 Vitória!' : '💥 Derrota'; t.className = won ? 'win' : 'lose';
  setText($('endSub'), (m.winner === 'hide' ? 'Os objetos venceram! ' : 'Os caçadores venceram! ') + m.reason);
  const col = (team, title, cls, fn) => {
    const rows = m.stats.filter(s => s.t0 === team).map(s => `<div class="r"><b>${s.n}</b><small>${fn(s)}</small></div>`).join('');
    return `<div><h4 class="${cls}">${title}</h4>${rows || '<small>—</small>'}</div>`;
  };
  $('endList').innerHTML =
    col('hide', '🎭 Objetos', 'h4h', s => s.found ? 'encontrado aos ' + fmt(s.surv) : 'sobreviveu até o fim') +
    col('seek', '🔍 Caçadores', 'h4s', s => s.tags + (s.tags === 1 ? ' objeto achado' : ' objetos achados'));
  $('end').classList.add('show');
  won ? SFX.win() : SFX.lose();
}
$('btnBack').onclick = () => { $('end').classList.remove('show'); stopGame(); show('lobby'); if (room) renderLobby(); };

/* ---- entrada ---- */
const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
addEventListener('keydown', e => {
  if (!game || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) { game.keys[KEYMAP[k]] = true; e.preventDefault(); }
  else if (k === 'e' && !e.repeat) send({ t: 'copy' });
  else if (k === 'q' && !e.repeat) send({ t: 'sonar' });
});
addEventListener('keyup', e => { if (game && KEYMAP[e.key.toLowerCase()]) game.keys[KEYMAP[e.key.toLowerCase()]] = false; });
addEventListener('blur', () => { if (game) game.keys = {}; });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousemove', e => { if (game) { game.mouse.sx = e.clientX; game.mouse.sy = e.clientY; } });
function mouseWorld() {
  const g = game;
  return { x: g.mouse.sx / g.zoom + g.cam.x, y: g.mouse.sy / g.zoom + g.cam.y };
}
cv.addEventListener('mousedown', e => {
  if (!game || e.button !== 0 || game.team !== 'seek' || game.phase !== 'playing') return;
  game.mouse.sx = e.clientX; game.mouse.sy = e.clientY;
  const w = mouseWorld();
  send({ t: 'tag', x: Math.round(w.x), y: Math.round(w.y) });
  game.fx.push({ x: w.x, y: w.y, t0: performance.now() });
});

/* ---- loop ---- */
let lastTs = 0;
function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (!game) return;
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016); lastTs = ts;
  update(dt, ts); draw(ts); hud(ts);
}

function update(dt, now) {
  const g = game, k = g.keys;
  let dx = (k.right ? 1 : 0) - (k.left ? 1 : 0), dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  const len = Math.hypot(dx, dy);
  if (len) { dx /= len; dy /= len; }
  if (g.pred && g.me.mv && len) {
    const sp = g.team === 'hide' ? C.SPEED_HIDE : C.SPEED_SEEK;
    const [nx, ny] = moveCircle(g.map, g.pred.x, g.pred.y, dx, dy, sp * dt);
    g.pred.x = nx; g.pred.y = ny;
  }
  let a = 0;
  if (g.pred) {
    if (g.team === 'seek') { const w = mouseWorld(); a = Math.atan2(w.y - g.pred.y, w.x - g.pred.x); }
    else if (len) a = Math.atan2(dy, dx);
    else a = g.myA || 0;
    g.myA = a;
  }
  const f = 1 - Math.exp(-dt * 18);
  for (const e of g.ents.values()) {
    if (e.key === g.youKey && g.pred) { e.x = g.pred.x; e.y = g.pred.y; e.a = a; }
    else { e.x += (e.tx - e.x) * f; e.y += (e.ty - e.y) * f; }
  }
  if (now - g.lastSend > 50) {
    g.lastSend = now;
    send({ t: 'in', dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100, a: Math.round(a * 100) / 100 });
  }
}

function drawProp(t, x, y) {
  const sp = sprite(t);
  ctx.drawImage(sp.c, x - sp.s / 2, y - sp.s / 2 - 2, sp.s, sp.s);
}
function label(text, x, y, color) {
  ctx.font = 'bold 12px "Trebuchet MS",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function drawHider(e, now) {
  const r = PROPS[e.d] ? PROPS[e.d].r : 16;
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + r * .75, r * .9, r * .38, 0, 0, 6.283); ctx.fill();
  if (PROPS[e.d]) drawProp(e.d, e.x, e.y);
  if (game.team === 'hide') {
    if (e.key === game.youKey) {
      ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 3; ctx.globalAlpha = .6 + .4 * Math.sin(now / 200);
      ctx.beginPath(); ctx.ellipse(e.x, e.y + r * .6, r + 8, (r + 8) * .45, 0, 0, 6.283); ctx.stroke(); ctx.globalAlpha = 1;
      label('você', e.x, e.y - r - 14, '#2dd4bf');
    } else if (e.n) label('▾ ' + e.n, e.x, e.y - r - 14, '#99f6e4');
  }
}
function drawSeeker(e, now) {
  const r = C.PR, x = e.x, y = e.y;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y + r * .8, r, r * .4, 0, 0, 6.283); ctx.fill();
  ctx.fillStyle = e.stun ? '#8a90a6' : 'hsl(' + hue(e.id) + ' 70% 55%)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = e.id === myId ? '#fff' : 'rgba(0,0,0,.55)'; ctx.stroke();
  const ex = Math.cos(e.a), ey = Math.sin(e.a), px = -ey, py = ex;
  for (const s of [-1, 1]) {
    const cx = x + ex * 6 + px * 5 * s, cy = y + ey * 6 + py * 5 * s;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 3.8, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx + ex * 1.5, cy + ey * 1.5, 1.9, 0, 6.283); ctx.fill();
  }
  label(e.n || '', x, y - r - 12, e.id === myId ? '#fde68a' : '#fed7aa');
  if (e.stun) { ctx.font = '18px ' + EMOJI; ctx.textAlign = 'center'; ctx.fillText('💫', x, y - r - 28 + Math.sin(now / 120) * 2); }
}

function draw(now) {
  const g = game, dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, W, H);
  if (!g.pred) return;
  const m = g.map, z = g.zoom, vw = W / z, vh = H / z;
  const cx = m.w <= vw ? (m.w - vw) / 2 : clamp(g.pred.x - vw / 2, 0, m.w - vw);
  const cy = m.h <= vh ? (m.h - vh) / 2 : clamp(g.pred.y - vh / 2, 0, m.h - vh);
  g.cam = { x: cx, y: cy, vw, vh };
  ctx.setTransform(dpr * z, 0, 0, dpr * z, -cx * dpr * z, -cy * dpr * z);
  ctx.drawImage(g.layer, 0, 0, m.w, m.h);

  const items = [];
  for (const p of m.props) {
    if (p.x < cx - 50 || p.x > cx + vw + 50 || p.y < cy - 50 || p.y > cy + vh + 50) continue;
    items.push({ y: p.y, k: 0, p });
  }
  for (const e of g.ents.values()) items.push({ y: e.y, k: e.kind === 'hide' ? 1 : 2, e });
  items.sort((a, b) => a.y - b.y);

  // anel de alcance e alvo de cópia (abaixo das entidades)
  if (g.team === 'seek' && g.phase === 'playing') {
    ctx.save(); ctx.setLineDash([8, 8]); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.pred.x, g.pred.y, C.TAG_RANGE, 0, 6.283); ctx.stroke(); ctx.restore();
  }
  let target = null;
  if (g.team === 'hide') {
    let bd = C.COPY_RANGE;
    for (const p of m.props) { const d = Math.hypot(p.x - g.pred.x, p.y - g.pred.y); if (d < bd) { bd = d; target = p; } }
    if (target) {
      const r = PROPS[target.t].r + 8;
      ctx.save(); ctx.setLineDash([6, 5]); ctx.lineDashOffset = -now / 40; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, 6.283); ctx.stroke(); ctx.restore();
    }
  }

  for (const it of items) {
    if (it.k === 0) drawProp(it.p.t, it.p.x, it.p.y);
    else if (it.k === 1) drawHider(it.e, now);
    else drawSeeker(it.e, now);
  }
  if (target) label('E', target.x, target.y - PROPS[target.t].r - 14, '#fff');

  // mira
  if (g.team === 'seek' && g.phase === 'playing') {
    const w = mouseWorld(), inR = Math.hypot(w.x - g.pred.x, w.y - g.pred.y) <= C.TAG_RANGE;
    ctx.strokeStyle = inR ? '#4ade80' : '#f87171'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w.x, w.y, 12, 0, 6.283); ctx.moveTo(w.x - 18, w.y); ctx.lineTo(w.x - 6, w.y);
    ctx.moveTo(w.x + 6, w.y); ctx.lineTo(w.x + 18, w.y); ctx.moveTo(w.x, w.y - 18); ctx.lineTo(w.x, w.y - 6);
    ctx.moveTo(w.x, w.y + 6); ctx.lineTo(w.x, w.y + 18); ctx.stroke();
  }
  // cliques
  g.fx = g.fx.filter(f => now - f.t0 < 400);
  for (const f of g.fx) {
    const p = (now - f.t0) / 400; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - p) + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(f.x, f.y, 8 + p * 26, 0, 6.283); ctx.stroke();
  }
  // sonar
  if (g.sonar) {
    const age = (now - g.sonar.t0) / 1000;
    if (age > 4) g.sonar = null;
    else {
      const al = Math.min(1, (4 - age) / 1.2), s = g.sonar;
      ctx.save(); ctx.globalAlpha = al; ctx.strokeStyle = '#fbbf24'; ctx.fillStyle = '#fbbf24'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(g.pred.x, g.pred.y, 40 + (age * 140) % 160, 0, 6.283); ctx.globalAlpha = al * .4; ctx.stroke(); ctx.globalAlpha = al;
      const bx = g.pred.x + Math.cos(s.ang) * 70, by = g.pred.y + Math.sin(s.ang) * 70;
      ctx.translate(bx, by); ctx.rotate(s.ang);
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

function hud(now) {
  const g = game, rem = Math.max(0, g.tl - (now - g.tlAt) / 1000);
  setText($('timer'), fmt(rem));
  setText($('phaseLabel'), g.phase === 'hiding' ? 'Fase de esconder' : 'Caçada');
  setText($('cntH'), String(g.counts.h)); setText($('cntS'), String(g.counts.s));
  const seek = g.team === 'seek';
  if (seek) {
    setText($('roleTitle'), '🔍 Você é CAÇADOR');
    $('roleKeys').innerHTML = '<kbd>WASD</kbd> mover · <b>Clique</b> pegar suspeito · <kbd>Q</kbd> sonar<br>Errar um objeto de verdade = atordoado!';
  } else {
    setText($('roleTitle'), '🎭 Você é um OBJETO');
    $('roleKeys').innerHTML = '<kbd>WASD</kbd> mover · <kbd>E</kbd> copiar objeto próximo<br>Fique parado perto de objetos iguais ao seu.';
  }
  $('roleTitle').style.color = seek ? '#fb923c' : '#2dd4bf';
  const sb = $('sonarBox');
  sb.classList.toggle('hidden', !(seek && g.phase === 'playing'));
  if (seek) {
    const cd = Math.max(0, g.me.sc - (now - g.tlAt) / 1000);
    $('sonarFill').style.width = (100 - (cd / C.SONAR_CD) * 100) + '%';
    setText($('sonarTxt'), cd > 0 ? 'Sonar recarregando… ' + Math.ceil(cd) + 's' : 'Sonar pronto — aperte Q');
  }
  const sm = $('sonarMsg');
  if (g.sonar) {
    const d = g.sonar.dist;
    setText(sm, d < 250 ? '🔊 Muito perto!' : d < 550 ? '🔊 Perto' : '🔊 Longe');
    sm.classList.remove('hidden');
  } else sm.classList.add('hidden');
  const covered = seek && g.phase === 'hiding';
  $('cover').classList.toggle('hidden', !covered);
  if (covered) setText($('coverT'), String(Math.ceil(rem)));
  const sec = Math.ceil(rem);
  if (g.phase === 'hiding' && sec <= 5 && sec !== g.lastSec) { g.lastSec = sec; SFX.tick(); }
}

})();
