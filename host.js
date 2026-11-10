/* Motor da partida (antes era o server.js). Roda no navegador de quem criou a sala. */
(function (root) {
  'use strict';
  const S = (typeof module !== 'undefined' && module.exports) ? require('./maps.js') : root.GameShared;
  const { C, PROPS, MAPS, moveCircle } = S;
  const MAX_PLAYERS = 12;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r1 = n => Math.round(n * 10) / 10;
  const now = () => Date.now();

  // Timer em Web Worker: não é freado quando a aba do anfitrião fica em segundo plano.
  function startTimer(fn, ms) {
    try {
      const blob = new Blob(['setInterval(function(){postMessage(0)},' + ms + ')'], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      w.onmessage = fn;
      return () => { w.terminate(); URL.revokeObjectURL(url); };
    } catch (e) {
      const h = setInterval(fn, ms);
      return () => clearInterval(h);
    }
  }

  function create(opts) {
    opts = opts || {};
    const HIDE_TIME = opts.hideTime || C.HIDE_TIME;
    const ROUND_TIME = opts.roundTime || C.ROUND_TIME;
    const room = {
      code: opts.code || '----', players: new Map(), host: null, mapId: MAPS[0].id,
      state: 'lobby', phase: 'lobby', phaseEnd: 0, playStart: 0, map: null
    };
    let idCounter = 2, stopTimer = null, last = now();

    const send = (p, o) => { try { p.send(o); } catch (e) { /* conexão caiu */ } };
    const broadcast = o => { for (const p of room.players.values()) send(p, o); };

    function pushRoom() {
      const players = [...room.players.values()].map(q => ({ id: q.id, name: q.name, team: q.team }));
      for (const p of room.players.values()) {
        send(p, { t: 'room', code: room.code, host: room.host, mapId: room.mapId, state: room.state, you: p.id, players });
      }
    }

    function addPlayer(id, sendFn, name) {
      if (room.state !== 'lobby') { sendFn({ t: 'err', m: 'A partida já começou. Espere a próxima rodada.' }); return false; }
      if (room.players.size >= MAX_PLAYERS) { sendFn({ t: 'err', m: 'Sala cheia.' }); return false; }
      const list = [...room.players.values()];
      const nh = list.filter(p => p.team === 'hide').length, ns = list.length - nh;
      const clean = String(name || '').replace(/[<>&"]/g, '').trim().slice(0, 14) || 'Jogador';
      room.players.set(id, {
        id, send: sendFn, name: clean, team: nh <= ns ? 'hide' : 'seek', team0: 'hide',
        x: 0, y: 0, a: 0, dx: 0, dy: 0, disg: null, k: 0, found: false, foundAt: 0,
        stunUntil: 0, tagAt: 0, sonarAt: 0, copyAt: 0, tags: 0
      });
      if (!room.host) room.host = id;
      pushRoom();
      return true;
    }

    function removePlayer(id) {
      if (!room.players.delete(id)) return;
      if (room.players.size === 0) return;
      if (room.host === id) room.host = room.players.keys().next().value;
      if (room.state === 'game') checkTeams();
      pushRoom();
    }

    function countTeams() {
      let h = 0, s = 0;
      for (const p of room.players.values()) { if (p.team === 'hide') h++; else s++; }
      return { h, s };
    }
    function checkTeams() {
      const { h, s } = countTeams();
      if (h === 0) endRound('seek', 'Todos os objetos foram encontrados ou saíram!');
      else if (s === 0) endRound('hide', 'Os caçadores saíram da partida.');
    }

    function startGame() {
      const map = MAPS.find(m => m.id === room.mapId) || MAPS[0];
      const t = now();
      room.map = map; room.state = 'game'; room.phase = 'hiding';
      room.phaseEnd = t + HIDE_TIME * 1000; room.playStart = 0; last = t;
      const list = [...room.players.values()];
      const nHide = list.filter(p => p.team === 'hide').length;
      const keys = Array.from({ length: nHide }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
      let hi = 0;
      for (const p of list) {
        p.team0 = p.team; p.found = false; p.foundAt = 0; p.tags = 0;
        p.stunUntil = 0; p.tagAt = 0; p.sonarAt = 0; p.copyAt = 0; p.dx = p.dy = 0; p.a = 0;
        const s = p.team === 'hide' ? map.spawns.hide : map.spawns.seek;
        const pos = moveCircle(map, s[0] + rnd(-50, 50), s[1] + rnd(-50, 50), 0, 0, 0);
        p.x = pos[0]; p.y = pos[1];
        if (p.team === 'hide') {
          p.k = keys[hi++];
          p.disg = map.types[Math.floor(Math.random() * map.types.length)];
        } else { p.k = 0; p.disg = null; }
      }
      broadcast({ t: 'start', mapId: map.id });
    }

    function canMove(p, t) {
      if (room.phase === 'hiding') return p.team === 'hide';
      if (room.phase === 'playing') return p.team === 'hide' || t >= p.stunUntil;
      return false;
    }

    function endRound(winner, reason) {
      if (room.state !== 'game') return;
      const t = now();
      const stats = [...room.players.values()].map(p => ({
        id: p.id, n: p.name, t0: p.team0, tags: p.tags, found: p.found,
        surv: p.team0 === 'hide' ? Math.max(0, Math.round(((p.found ? p.foundAt : t) - (room.playStart || t)) / 1000)) : 0
      }));
      room.state = 'lobby'; room.phase = 'lobby';
      broadcast({ t: 'end', winner, reason, stats });
      for (const p of room.players.values()) p.team = p.team0 === 'hide' ? 'seek' : 'hide';
      pushRoom();
    }

    function snapshot(p, t) {
      const sk = [], hd = [];
      const hiderView = p.team === 'hide';
      for (const q of room.players.values()) {
        if (q.team === 'seek') {
          sk.push({ i: q.id, n: q.name, x: r1(q.x), y: r1(q.y), a: Math.round(q.a * 100) / 100, s: t < q.stunUntil ? 1 : 0, f: q.found ? 1 : 0 });
        } else if (hiderView) {
          hd.push({ k: q.k, i: q.id, n: q.name, x: r1(q.x), y: r1(q.y), d: q.disg });
        } else {
          hd.push({ k: q.k, x: r1(q.x), y: r1(q.y), d: q.disg });
        }
      }
      return {
        t: 's', ph: room.phase, tl: Math.max(0, (room.phaseEnd - t) / 1000), sk, hd,
        me: { mv: canMove(p, t) ? 1 : 0, sc: Math.max(0, (p.sonarAt - t) / 1000) }
      };
    }

    function tick() {
      if (room.state !== 'game') { last = now(); return; }
      const t = now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (room.phase === 'hiding' && t >= room.phaseEnd) {
        room.phase = 'playing'; room.phaseEnd = t + ROUND_TIME * 1000; room.playStart = t;
        broadcast({ t: 'ev', k: 'go' });
      }
      for (const p of room.players.values()) {
        if (!canMove(p, t)) continue;
        const len = Math.hypot(p.dx, p.dy);
        if (len < 0.01) continue;
        const sp = p.team === 'hide' ? C.SPEED_HIDE : C.SPEED_SEEK;
        const pos = moveCircle(room.map, p.x, p.y, p.dx / len, p.dy / len, sp * dt);
        p.x = pos[0]; p.y = pos[1];
      }
      if (room.phase === 'playing' && t >= room.phaseEnd) {
        return endRound('hide', 'O tempo acabou e os objetos não foram todos encontrados!');
      }
      for (const p of room.players.values()) send(p, snapshot(p, t));
    }

    function handleTag(p, m) {
      const t = now();
      if (room.phase !== 'playing' || p.team !== 'seek' || t < p.stunUntil || t < p.tagAt) return;
      p.tagAt = t + 350;
      const x = Number(m.x), y = Number(m.y);
      if (!isFinite(x) || !isFinite(y)) return;
      if (Math.hypot(x - p.x, y - p.y) > C.TAG_RANGE + 10) return;
      let best = null, bd = 1e9;
      for (const h of room.players.values()) {
        if (h.team !== 'hide') continue;
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < PROPS[h.disg].r + 10 && d < bd) { best = h; bd = d; }
      }
      if (best) {
        best.team = 'seek'; best.found = true; best.foundAt = t; best.stunUntil = t + 1500; best.disg = null;
        p.tags++;
        const left = countTeams().h;
        broadcast({ t: 'ev', k: 'found', by: p.name, who: best.name, whoId: best.id, left });
        if (left === 0) endRound('seek', 'Todos os objetos foram encontrados!');
        return;
      }
      for (const pr of room.map.props) {
        if (Math.hypot(pr.x - x, pr.y - y) <= PROPS[pr.t].r + 6) {
          p.stunUntil = t + C.STUN * 1000;
          send(p, { t: 'ev', k: 'stun' });
          return;
        }
      }
    }

    function handleCopy(p) {
      const t = now();
      if (p.team !== 'hide' || room.phase === 'lobby' || t < p.copyAt) return;
      let best = null, bd = C.COPY_RANGE;
      for (const pr of room.map.props) {
        const d = Math.hypot(pr.x - p.x, pr.y - p.y);
        if (d < bd) { best = pr; bd = d; }
      }
      if (!best) return send(p, { t: 'ev', k: 'nocopy' });
      p.copyAt = t + 600;
      p.disg = best.t;
      send(p, { t: 'ev', k: 'copy' });
    }

    function handleSonar(p) {
      const t = now();
      if (room.phase !== 'playing' || p.team !== 'seek' || t < p.sonarAt) return;
      let best = null, bd = 1e9;
      for (const h of room.players.values()) {
        if (h.team !== 'hide') continue;
        const d = Math.hypot(h.x - p.x, h.y - p.y);
        if (d < bd) { best = h; bd = d; }
      }
      if (!best) return;
      p.sonarAt = t + C.SONAR_CD * 1000;
      const ang = Math.atan2(best.y - p.y, best.x - p.x) + rnd(-0.35, 0.35);
      send(p, { t: 'ev', k: 'sonar', ang, dist: Math.round(bd) });
    }

    function onMessage(id, m) {
      const p = room.players.get(id);
      if (!p || !m || typeof m.t !== 'string') return;
      switch (m.t) {
        case 'team':
          if (room.state !== 'lobby') return;
          if (m.team === 'hide' || m.team === 'seek') { p.team = m.team; pushRoom(); }
          break;
        case 'map':
          if (room.state !== 'lobby' || room.host !== p.id) return;
          if (MAPS.some(x => x.id === m.id)) { room.mapId = m.id; pushRoom(); }
          break;
        case 'start': {
          if (room.state !== 'lobby' || room.host !== p.id) return;
          const c = countTeams();
          if (c.h < 1 || c.s < 1) return send(p, { t: 'err', m: 'Precisa de pelo menos 1 jogador em cada equipe.' });
          startGame();
          break;
        }
        case 'in':
          p.dx = clamp(Number(m.dx) || 0, -1, 1);
          p.dy = clamp(Number(m.dy) || 0, -1, 1);
          p.a = Number(m.a) || 0;
          break;
        case 'tag': if (room.state === 'game') handleTag(p, m); break;
        case 'copy': if (room.state === 'game') handleCopy(p); break;
        case 'sonar': if (room.state === 'game') handleSonar(p); break;
      }
    }

    return {
      room,
      nextId: () => idCounter++,
      addPlayer, removePlayer, onMessage,
      start() { if (!stopTimer) stopTimer = startTimer(tick, 1000 / 30); },
      stop() { if (stopTimer) { stopTimer(); stopTimer = null; } },
      tickOnce: tick
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HostEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
