/* Mapas, objetos e física compartilhados entre servidor (Node) e cliente (navegador). */
(function (root) {
  'use strict';

  const C = {
    PR: 14,            // raio dos jogadores
    SPEED_HIDE: 170,   // velocidade dos objetos (px/s)
    SPEED_SEEK: 190,   // velocidade dos caçadores (px/s)
    TAG_RANGE: 130,    // alcance do clique do caçador
    STUN: 1.5,         // segundos atordoado ao errar
    HIDE_TIME: 15,     // segundos para se esconder
    ROUND_TIME: 300,   // 5 minutos de caçada
    SONAR_CD: 25,      // recarga do sonar
    COPY_RANGE: 100    // alcance para copiar um objeto (tecla E)
  };

  const PROPS = {
    chair: { e: '🪑', r: 16 }, sofa: { e: '🛋️', r: 26 }, plant: { e: '🪴', r: 16 }, box: { e: '📦', r: 18 },
    barrel: { e: '🛢️', r: 18 }, tree: { e: '🌳', r: 32 }, pine: { e: '🌲', r: 30 }, flower: { e: '🌷', r: 12 },
    rock: { e: '🪨', r: 16 }, bed: { e: '🛏️', r: 28 }, tv: { e: '📺', r: 18 }, books: { e: '📚', r: 14 },
    trash: { e: '🗑️', r: 16 }, vase: { e: '🏺', r: 14 }, backpack: { e: '🎒', r: 14 }, ball: { e: '⚽', r: 12 },
    bike: { e: '🚲', r: 22 }, bucket: { e: '🪣', r: 14 }, toolbox: { e: '🧰', r: 16 }, log: { e: '🪵', r: 16 },
    cart: { e: '🛒', r: 22 }, can: { e: '🥫', r: 12 }, apple: { e: '🍎', r: 12 }, computer: { e: '🖥️', r: 18 },
    juice: { e: '🧃', r: 12 }, bread: { e: '🍞', r: 12 }
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Move um círculo (jogador) e resolve colisões com as paredes.
  function moveCircle(map, x, y, dx, dy, dist) {
    const r = C.PR;
    let nx = clamp(x + dx * dist, r, map.w - r);
    let ny = clamp(y + dy * dist, r, map.h - r);
    for (let it = 0; it < 3; it++) {
      for (const w of map.walls) {
        const cx = clamp(nx, w.x, w.x + w.w), cy = clamp(ny, w.y, w.y + w.h);
        const ox = nx - cx, oy = ny - cy, d2 = ox * ox + oy * oy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = cx + (ox / d) * r; ny = cy + (oy / d) * r;
        } else {
          const l = nx - w.x, rr = w.x + w.w - nx, t = ny - w.y, b = w.y + w.h - ny;
          const m = Math.min(l, rr, t, b);
          if (m === l) nx = w.x - r; else if (m === rr) nx = w.x + w.w + r;
          else if (m === t) ny = w.y - r; else ny = w.y + w.h + r;
        }
      }
    }
    return [nx, ny];
  }

  function build(def) {
    const R = rng(def.seed);
    const map = {
      id: def.id, name: def.name, desc: def.desc, w: def.w, h: def.h,
      floor: def.floor, pattern: def.pattern, spawns: def.spawns,
      zones: [], walls: [], props: [], types: []
    };
    const wall = (x, y, w, h, s) => map.walls.push({ x, y, w, h, s: s || 'wall' });
    const zone = (x, y, w, h, c) => map.zones.push({ x, y, w, h, c });
    function free(x, y, r) {
      if (x < r + 14 || y < r + 14 || x > map.w - r - 14 || y > map.h - r - 14) return false;
      for (const w of map.walls) {
        const cx = clamp(x, w.x, w.x + w.w), cy = clamp(y, w.y, w.y + w.h);
        if ((x - cx) ** 2 + (y - cy) ** 2 < (r + 10) ** 2) return false;
      }
      for (const p of map.props) {
        const d = PROPS[p.t].r + r + 6;
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < d * d) return false;
      }
      for (const k in map.spawns) {
        const s = map.spawns[k];
        if ((x - s[0]) ** 2 + (y - s[1]) ** 2 < 110 * 110) return false;
      }
      return true;
    }
    function scatter(t, n, rect) {
      const r = PROPS[t].r;
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 50; a++) {
          const x = rect[0] + R() * rect[2], y = rect[1] + R() * rect[3];
          if (free(x, y, r)) { map.props.push({ t, x: Math.round(x), y: Math.round(y) }); break; }
        }
      }
    }
    def.build({ wall, zone, scatter, map });
    map.props.sort((a, b) => a.y - b.y);
    const counts = {};
    for (const p of map.props) counts[p.t] = (counts[p.t] || 0) + 1;
    map.types = Object.keys(counts).filter(t => counts[t] >= 3);
    return map;
  }

  const T = 24;
  const defs = [
    {
      id: 'casa', name: 'Casa', desc: 'Quartos, sala, cozinha e garagem. Muitas portas para fugir.',
      seed: 11, w: 1600, h: 1100, floor: '#c9a67a', pattern: 'wood',
      spawns: { hide: [800, 400], seek: [800, 900] },
      build({ wall, zone, scatter }) {
        zone(30, 30, 510, 520, '#c7a98f'); zone(30, 574, 510, 496, '#d8d8cf');
        zone(564, 30, 496, 670, '#b98f6a'); zone(564, 724, 496, 346, '#cfc3a8');
        zone(1084, 30, 486, 520, '#a9b7c4'); zone(1084, 574, 486, 496, '#9a9a9a');
        wall(0, 0, 1600, 30); wall(0, 1070, 1600, 30); wall(0, 0, 30, 1100); wall(1570, 0, 30, 1100);
        wall(540, 30, T, 170); wall(540, 300, T, 400); wall(540, 800, T, 270);
        wall(1060, 30, T, 350); wall(1060, 480, T, 370); wall(1060, 950, T, 120);
        wall(30, 550, 170, T); wall(300, 550, 240, T);
        wall(1084, 550, 166, T); wall(1350, 550, 220, T);
        wall(564, 700, 186, T); wall(850, 700, 210, T);
        const bed = [60, 60, 450, 460], kit = [60, 600, 450, 440], liv = [590, 60, 440, 620],
          din = [590, 750, 440, 290], off = [1110, 60, 430, 460], gar = [1110, 600, 430, 440];
        scatter('bed', 3, bed); scatter('plant', 3, bed); scatter('books', 4, bed); scatter('chair', 2, bed); scatter('backpack', 2, bed); scatter('vase', 2, bed);
        scatter('box', 4, kit); scatter('trash', 3, kit); scatter('can', 4, kit); scatter('bucket', 2, kit); scatter('chair', 4, kit); scatter('bread', 3, kit); scatter('apple', 3, kit);
        scatter('sofa', 3, liv); scatter('tv', 2, liv); scatter('plant', 4, liv); scatter('chair', 4, liv); scatter('books', 3, liv); scatter('vase', 3, liv); scatter('ball', 2, liv);
        scatter('chair', 6, din); scatter('vase', 3, din); scatter('plant', 2, din); scatter('bread', 2, din);
        scatter('computer', 4, off); scatter('chair', 5, off); scatter('books', 5, off); scatter('plant', 3, off); scatter('trash', 2, off); scatter('backpack', 2, off);
        scatter('box', 6, gar); scatter('barrel', 4, gar); scatter('bike', 3, gar); scatter('toolbox', 3, gar); scatter('bucket', 3, gar); scatter('trash', 2, gar);
      }
    },
    {
      id: 'armazem', name: 'Armazém', desc: 'Corredores de prateleiras cheios de caixas e barris. Difícil achar quem é quem.',
      seed: 22, w: 2000, h: 1200, floor: '#8d8f94', pattern: 'concrete',
      spawns: { hide: [1000, 120], seek: [1000, 1050] },
      build({ wall, scatter }) {
        wall(0, 0, 2000, 30); wall(0, 1170, 2000, 30); wall(0, 0, 30, 1200); wall(1970, 0, 30, 1200);
        [250, 450, 650, 850].forEach((y, i) => {
          const off = i % 2 ? 170 : 0;
          for (let x = 150 + off; x + 260 <= 1850; x += 340) wall(x, y, 260, 34, 'shelf');
        });
        const bands = [[60, 60, 1880, 170], [60, 290, 1880, 150], [60, 490, 1880, 150], [60, 690, 1880, 150], [60, 890, 1880, 260]];
        bands.forEach(b => {
          scatter('box', 8, b); scatter('barrel', 3, b); scatter('bucket', 2, b); scatter('toolbox', 1, b); scatter('trash', 1, b);
        });
        scatter('bike', 3, [60, 60, 1880, 1100]); scatter('backpack', 3, [60, 60, 1880, 1100]);
      }
    },
    {
      id: 'parque', name: 'Parque', desc: 'Ao ar livre: árvores, lago, labirinto de cerca-viva e bancos.',
      seed: 33, w: 2000, h: 1400, floor: '#5f9f4a', pattern: 'grass',
      spawns: { hide: [1000, 150], seek: [150, 1250] },
      build({ wall, zone, scatter }) {
        zone(0, 660, 2000, 80, '#d9c9a0'); zone(960, 0, 80, 1400, '#d9c9a0');
        wall(0, 0, 2000, 24, 'hedge'); wall(0, 1376, 2000, 24, 'hedge'); wall(0, 0, 24, 1400, 'hedge'); wall(1976, 0, 24, 1400, 'hedge');
        wall(780, 520, 440, 300, 'water');
        wall(1450, 150, 300, 24, 'hedge'); wall(1450, 150, 24, 260, 'hedge'); wall(1450, 390, 200, 24, 'hedge');
        wall(1650, 260, 24, 150, 'hedge'); wall(1550, 260, 100, 24, 'hedge');
        wall(200, 900, 24, 260, 'hedge'); wall(200, 900, 260, 24, 'hedge'); wall(350, 1100, 24, 200, 'hedge');
        const all = [40, 40, 1920, 1320];
        scatter('tree', 24, all); scatter('pine', 20, all); scatter('flower', 26, all); scatter('rock', 14, all);
        scatter('log', 6, all); scatter('chair', 8, all); scatter('bike', 3, all); scatter('ball', 3, all);
        scatter('trash', 6, all); scatter('backpack', 3, all);
      }
    },
    {
      id: 'escola', name: 'Escola', desc: 'Corredor central com salas de aula, biblioteca, laboratório e ginásio.',
      seed: 44, w: 1900, h: 1200, floor: '#cfd3c0', pattern: 'tiles',
      spawns: { hide: [1700, 610], seek: [200, 610] },
      build({ wall, zone, scatter }) {
        const xs = [30, 490, 950, 1410, 1870];
        zone(30, 524, 1840, 176, '#e6e2cf');
        const topC = ['#d8c9a5', '#d6c4d9', '#c4d7d2', '#d8c9a5'], botC = ['#e0cdb0', '#e0b9a8', '#c4d7d2', '#c8c8c8'];
        wall(0, 0, 1900, 30); wall(0, 1170, 1900, 30); wall(0, 0, 30, 1200); wall(1870, 0, 30, 1200);
        for (let i = 0; i < 4; i++) {
          zone(xs[i], 30, xs[i + 1] - xs[i], 470, topC[i]);
          zone(xs[i], 724, xs[i + 1] - xs[i], 446, botC[i]);
          const cx = (xs[i] + xs[i + 1]) / 2;
          wall(xs[i], 500, cx - 55 - xs[i], T); wall(cx + 55, 500, xs[i + 1] - (cx + 55), T);
          wall(xs[i], 700, cx - 55 - xs[i], T); wall(cx + 55, 700, xs[i + 1] - (cx + 55), T);
        }
        for (const x of [490, 950, 1410]) { wall(x, 30, T, 470); wall(x, 724, T, 446); }
        const A = [60, 60, 400, 410], B = [520, 60, 400, 410], Cc = [980, 60, 400, 410], D = [1440, 60, 400, 410];
        const E = [60, 750, 400, 410], F = [520, 750, 400, 410], G = [980, 750, 400, 410], H = [1440, 750, 400, 410];
        scatter('chair', 10, A); scatter('books', 6, A); scatter('backpack', 5, A); scatter('plant', 2, A); scatter('trash', 1, A);
        scatter('books', 8, B); scatter('chair', 4, B); scatter('plant', 3, B); scatter('vase', 2, B);
        scatter('computer', 8, Cc); scatter('chair', 8, Cc); scatter('backpack', 3, Cc); scatter('trash', 2, Cc);
        scatter('chair', 10, D); scatter('books', 5, D); scatter('backpack', 5, D);
        scatter('chair', 10, E); scatter('apple', 4, E); scatter('juice', 4, E); scatter('bread', 4, E); scatter('trash', 3, E);
        scatter('ball', 8, F); scatter('bucket', 2, F); scatter('bike', 2, F); scatter('backpack', 3, F); scatter('box', 3, F);
        scatter('chair', 8, G); scatter('computer', 5, G); scatter('books', 4, G); scatter('plant', 2, G);
        scatter('box', 5, H); scatter('toolbox', 3, H); scatter('barrel', 2, H); scatter('trash', 3, H); scatter('plant', 3, H); scatter('chair', 4, H);
        const cor = [60, 545, 1780, 130];
        scatter('backpack', 5, cor); scatter('trash', 4, cor); scatter('plant', 4, cor); scatter('chair', 3, cor); scatter('ball', 2, cor); scatter('bucket', 2, cor);
      }
    },
    {
      id: 'mercado', name: 'Supermercado', desc: 'Corredores de gôndolas com carrinhos, latas, frutas e pães.',
      seed: 55, w: 1800, h: 1200, floor: '#e8e4d8', pattern: 'tiles',
      spawns: { hide: [900, 110], seek: [900, 1110] },
      build({ wall, zone, scatter }) {
        zone(30, 30, 600, 170, '#d6ebc4'); zone(1170, 30, 600, 170, '#f0dfb8'); zone(30, 820, 1740, 350, '#dcdcdc');
        wall(0, 0, 1800, 30); wall(0, 1170, 1800, 30); wall(0, 0, 30, 1200); wall(1770, 0, 30, 1200);
        [220, 400, 580, 760].forEach(y => { for (let x = 140; x <= 1310; x += 390) wall(x, y, 300, 30, 'shelf'); });
        wall(200, 1000, 200, 30, 'shelf'); wall(600, 1000, 200, 30, 'shelf'); wall(1000, 1000, 200, 30, 'shelf'); wall(1400, 1000, 200, 30, 'shelf');
        const top = [60, 40, 1680, 150];
        scatter('apple', 8, top); scatter('juice', 3, top); scatter('bread', 4, top); scatter('cart', 3, top); scatter('can', 3, top);
        [[60, 260, 1680, 110], [60, 440, 1680, 110], [60, 620, 1680, 110]].forEach(b => {
          scatter('can', 6, b); scatter('juice', 4, b); scatter('apple', 3, b); scatter('bread', 3, b); scatter('box', 3, b); scatter('cart', 2, b);
        });
        const bot = [60, 830, 1680, 320];
        scatter('cart', 6, bot); scatter('box', 3, bot); scatter('trash', 3, bot); scatter('plant', 4, bot); scatter('bucket', 2, bot); scatter('can', 4, bot);
      }
    }
  ];

  const MAPS = defs.map(build);
  const api = { C, PROPS, MAPS, moveCircle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameShared = api;
})(typeof window !== 'undefined' ? window : globalThis);
