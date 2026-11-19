/* Juan Patiño-Echeverría: the field (level curves and flow), the bar, the theme and view switches, the list reveal. */
(function () {
  'use strict';
  var root = document.documentElement;
  var hero = document.getElementById('top');
  var canvas = document.getElementById('field');
  var ctx = canvas.getContext('2d');
  var eqEls = Array.prototype.slice.call(document.querySelectorAll('.eq'));
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

  // the visitor's choices: the theme in sessionStorage (this visit) and localStorage (the next one);
  // the field view in sessionStorage only, so it is kept from page to page until a refresh
  function store(k, v, scope) {
    var stores = scope === 'session' ? ['sessionStorage'] : ['sessionStorage', 'localStorage'];
    stores.forEach(function (s) { try { if (v === null) window[s].removeItem(k); else window[s].setItem(k, v); } catch (e) {} });
  }
  function load(k, scope) {
    var stores = scope === 'session' ? ['sessionStorage'] : ['sessionStorage', 'localStorage'];
    for (var i = 0; i < stores.length; i++) { try { var v = window[stores[i]].getItem(k); if (v !== null) return v; } catch (e) {} }
    return null;
  }
  // an earlier version wrote its choices into window.name, which the Claude viewer uses for its own settings: tidy them away
  try { if (/jpe-(theme|field)=/.test(window.name)) window.name = window.name.replace(/;?jpe-(theme|field)=[a-z]+/g, ''); } catch (e) {}
  var navType = 'navigate';
  try { var navEntry = performance.getEntriesByType('navigation')[0]; if (navEntry && navEntry.type) navType = navEntry.type; } catch (e) {}

  // ---------------- Field parameters ----------------
  var W = 0, H = 0, dpr = 1, sigma = 60, gap = 16, cell = 8, tau = 75;
  var U = 1, Aw = 7, kx = 2 * Math.PI / 520, ky = 2 * Math.PI / 380, omega = 2 * Math.PI / 18;
  var GAMMA = 2.6;            // island strength, in units of sigma
  var SM = 90;                // pointer bump width (px)
  var mode = 'curves';   // every visit starts on the level curves; the flow is a switch for the curious
  var paused = false, onScreen = true, pageVisible = !document.hidden;
  var t = 0, last = 0, raf = 0, lastDraw = 0;

  // each equilibrium: where it sits (fractions of the field), the side its label goes, and the sign of its island
  var desktopAnchors = [[0.58, 0.31, 'r', 1], [0.82, 0.27, 'l', -1], [0.70, 0.58, 'r', 1], [0.88, 0.74, 'l', -1]];
  var phoneAnchors   = [[0.16, 0.15, 'r', 1], [0.62, 0.21, 'r', -1], [0.30, 0.39, 'r', 1], [0.68, 0.47, 'r', -1]];
  // an inner page names its own equilibrium; there it is not a link, it only answers the pointer
  var still = hero.hasAttribute('data-anchors');
  if (still) { try { var an = JSON.parse(hero.getAttribute('data-anchors')); desktopAnchors = an.desktop; phoneAnchors = an.phone; } catch (e) {} }
  var N = eqEls.length;
  var cx = new Float64Array(N), cy = new Float64Array(N), cs = new Float64Array(N);
  var gf = new Float64Array(N).fill(1);      // hover growth factor (eased)
  var sgn = desktopAnchors.map(function (a) { return a[3] || 1; });
  var hovered = -1;
  var sad = []; for (var s0 = 0; s0 < N; s0++) sad.push({ ok: false, x: 0, y: 0, psi: 0, psiC: 0, R: 0 });

  var ptr = { tx: -1e4, ty: -1e4, x: -1e4, y: -1e4, ta: 0, a: 0 };
  var pmx = 0, pmy = 0, pG = 0;

  // per-frame precomputed trig for the wave term
  var ph = 0;

  var col = { ink: [20, 24, 28], accent: '#C8102E', stable: '#1F4FBF', dark: false };

  function hexToRgb(h) {
    h = (h || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16); if (isNaN(n)) return [20, 24, 28];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function themeNow() {
    var a = root.getAttribute('data-jpe-theme');
    if (a === 'dark' || a === 'light') return a;
    return darkMQ.matches ? 'dark' : 'light';
  }
  // the field takes its colours from the CSS variables; if they are not there yet, from the same palette here
  var PALETTE = { light: { ink: '#14181C', red: '#C8102E', blue: '#1F4FBF' }, dark: { ink: '#E6EAED', red: '#FF5A5F', blue: '#7FA6FF' } };
  function readColours() {
    var csd = getComputedStyle(root), th = themeNow(), pal = PALETTE[th];
    col.ink = hexToRgb(csd.getPropertyValue('--ink').trim() || pal.ink);
    col.accent = csd.getPropertyValue('--accent').trim() || (root.getAttribute('data-jpe-accent') === 'blue' ? pal.blue : pal.red);
    col.stable = csd.getPropertyValue('--blue').trim() || pal.blue;
    col.dark = th === 'dark';
  }
  function inkA(a) { return 'rgba(' + col.ink[0] + ',' + col.ink[1] + ',' + col.ink[2] + ',' + a + ')'; }

  // ---------------- Stream function and its gradient ----------------
  // psi = U (y - H/2) + wave + sum_i [ s_i G_i exp(-r_i^2 / 2 sigma^2) - U (y - cy_i) exp(-r_i^2 / 2 tau^2) ] + pointer bump
  // The second term cancels the uniform stream at each centre, so every centre is an exact equilibrium.
  var inv2s2, invs2, inv2t2, invt2, inv2m2 = 1 / (2 * SM * SM), invm2 = 1 / (SM * SM);

  function psiAt(x, y) {
    var p = U * (y - H * 0.5) + Aw * Math.sin(kx * x - ph) * Math.sin(ky * y + 0.6 * ph);
    for (var i = 0; i < N; i++) {
      var dx = x - cx[i], dy = y - cy[i], r2 = dx * dx + dy * dy;
      p += cs[i] * Math.exp(-r2 * inv2s2) - U * dy * Math.exp(-r2 * inv2t2);
    }
    if (pG !== 0) { var mx = x - pmx, my = y - pmy; p += pG * Math.exp(-(mx * mx + my * my) * inv2m2); }
    return p;
  }
  var gOut = [0, 0];
  function gradAt(x, y, out) {
    var sx = Math.sin(kx * x - ph), cxw = Math.cos(kx * x - ph), sy = Math.sin(ky * y + 0.6 * ph), cyw = Math.cos(ky * y + 0.6 * ph);
    var px = Aw * kx * cxw * sy, py = U + Aw * ky * sx * cyw;
    for (var i = 0; i < N; i++) {
      var dx = x - cx[i], dy = y - cy[i], r2 = dx * dx + dy * dy;
      var e = cs[i] * Math.exp(-r2 * inv2s2);
      px -= e * dx * invs2; py -= e * dy * invs2;
      var w = Math.exp(-r2 * inv2t2);
      px += U * dy * dx * w * invt2; py += -U * w + U * dy * dy * w * invt2;
    }
    if (pG !== 0) {
      var mx = x - pmx, my = y - pmy, em = pG * Math.exp(-(mx * mx + my * my) * inv2m2);
      px -= em * mx * invm2; py -= em * my * invm2;
    }
    out[0] = px; out[1] = py; return out;
  }

  // Newton's method on grad(psi) = 0, used to locate the saddle (stagnation point) of each island
  var ga = [0, 0], gb = [0, 0], gc = [0, 0], gd = [0, 0], g0 = [0, 0];
  function newton(x, y) {
    var h = 0.5, det = 0;
    for (var k = 0; k < 14; k++) {
      gradAt(x, y, g0);
      gradAt(x + h, y, ga); gradAt(x - h, y, gb); gradAt(x, y + h, gc); gradAt(x, y - h, gd);
      var j00 = (ga[0] - gb[0]) / (2 * h), j10 = (ga[1] - gb[1]) / (2 * h);
      var j01 = (gc[0] - gd[0]) / (2 * h), j11 = (gc[1] - gd[1]) / (2 * h);
      det = j00 * j11 - j01 * j10;
      if (Math.abs(det) < 1e-12) break;
      var dx = (-g0[0] * j11 + g0[1] * j01) / det, dy = (-g0[1] * j00 + g0[0] * j10) / det;
      var step = Math.hypot(dx, dy), maxStep = sigma * 0.5;
      if (step > maxStep) { dx *= maxStep / step; dy *= maxStep / step; }
      x += dx; y += dy;
      if (step < 1e-3) break;
    }
    gradAt(x, y, g0);
    return { x: x, y: y, det: det, res: Math.hypot(g0[0], g0[1]) };
  }
  function findSaddles() {
    for (var i = 0; i < N; i++) {
      var best = null, bestD = Infinity, s = sad[i];
      var guesses = s.ok ? [[s.x, s.y]] : [];
      var r = 1.5 * sigma;
      guesses.push([cx[i], cy[i] + r], [cx[i], cy[i] - r], [cx[i] + r, cy[i]], [cx[i] - r, cy[i]]);
      for (var g = 0; g < guesses.length; g++) {
        var res = newton(guesses[g][0], guesses[g][1]);
        if (res.res < 2e-3 && res.det < 0) {
          var d = Math.hypot(res.x - cx[i], res.y - cy[i]);
          if (d > 0.4 * sigma && d < 3.2 * sigma && d < bestD) { best = res; bestD = d; }
        }
        if (best && g === 0 && s.ok) break;   // warm start succeeded
      }
      if (best) { s.ok = true; s.x = best.x; s.y = best.y; s.R = bestD; s.psi = psiAt(best.x, best.y); }
      else { s.ok = false; s.R = 2 * sigma; }
      s.psiC = psiAt(cx[i], cy[i]);
    }
  }

  // ---------------- Layout ----------------
  var phone = false;
  function layout() {
    var r = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    phone = W < 720;
    sigma = Math.max(40, Math.min(72, W * 0.045));
    tau = 1.25 * sigma;
    gap = phone ? 13 : 16;
    cell = phone ? 7 : 8;
    inv2s2 = 1 / (2 * sigma * sigma); invs2 = 1 / (sigma * sigma);
    inv2t2 = 1 / (2 * tau * tau); invt2 = 1 / (tau * tau);
    var anchors = phone ? phoneAnchors : desktopAnchors;
    eqEls.forEach(function (el, i) { el.classList.toggle('left', anchors[i][2] === 'l'); });
    for (var i = 0; i < N; i++) sad[i].ok = false;
    allocGrid();
    initParticles();
    arrange();
  }
  function arrange() { measureLabels(); separateLabels(); positionCentres(); }
  function positionCentres() {
    var anchors = phone ? phoneAnchors : desktopAnchors;
    for (var i = 0; i < N; i++) {
      var drift = phone ? 4 : 7;
      cx[i] = anchors[i][0] * W + offX[i] + drift * Math.sin(2 * Math.PI * t / 23 + i * 1.7);
      cy[i] = anchors[i][1] * H + offY[i] + drift * Math.cos(2 * Math.PI * t / 29 + i * 2.3);
      cs[i] = sgn[i] * GAMMA * sigma * gf[i];
      var el = eqEls[i];
      var ox = el.classList.contains('left') ? 'calc(-100% + ' + (cx[i] + 15.5).toFixed(1) + 'px)' : (cx[i] - 7.5).toFixed(1) + 'px';
      el.style.transform = 'translate(' + ox + ',' + (cy[i] - 9.5).toFixed(1) + 'px)';
    }
  }

  // ---------------- Label gaps ----------------
  // Like contour labels on a map, each destination's label interrupts the lines beneath it.
  var lblBox = [];
  function measureLabels() {
    lblBox = eqEls.map(function (el) {
      var l = el.querySelector('.lbl');
      if (!l) return { w: 0 };
      return { ox: l.offsetLeft, oy: l.offsetTop, w: l.offsetWidth, h: l.offsetHeight, ew: el.offsetWidth, eh: el.offsetHeight, left: el.classList.contains('left') };
    });
    measureBar();
  }

  // ---------------- Keeping the destinations apart ----------------
  // The anchors suit a typical window. Where two destinations (dot and label) would come closer than a minimum gap,
  // 2% of the field's width and at least 16 px, plus room for the drift, they move apart along whichever axis needs
  // the smaller move; each also keeps clear of the name, the tagline and the bar. Worked out once per layout, so nothing jitters.
  var offX = new Float64Array(N), offY = new Float64Array(N);
  function boxAt(i, x, y) {
    var b = lblBox[i], l = b.left ? x + 11.5 - b.ew : x - 11.5;
    return { l: l, r: l + b.ew, t: y - 13.5, b: y - 13.5 + b.eh };
  }
  function mastheadRects() {
    var out = [], r = hero.getBoundingClientRect(), rg = document.createRange();
    hero.querySelectorAll('.masthead h1 span, .masthead p').forEach(function (el) {
      rg.selectNodeContents(el); var q = rg.getBoundingClientRect();
      if (q.width) out.push({ l: q.left - r.left, r: q.right - r.left, t: q.top - r.top, b: q.bottom - r.top });
    });
    return out;
  }
  function separateLabels() {
    offX.fill(0); offY.fill(0);
    if (still || N < 2 || !lblBox.length || !lblBox[0].ew) return;
    var anchors = phone ? phoneAnchors : desktopAnchors;
    var drift = phone ? 4 : 7, gapMin = Math.max(16, 0.02 * W);
    var bar = document.getElementById('bar');
    var top = (bar ? bar.offsetHeight : 0) + 8 + drift, edge = 16 + drift;
    var fixed = mastheadRects();
    // how far each destination may move: its label stays inside the field, and its island never goes
    // further under the bar or off the bottom than its anchor already puts it
    var loX = [], hiX = [], loY = [], hiY = [];
    for (var n = 0; n < N; n++) {
      var ax = anchors[n][0] * W, ay = anchors[n][1] * H, b0 = boxAt(n, ax, ay);
      loX[n] = Math.min(0, edge - b0.l); hiX[n] = Math.max(loX[n], W - edge - b0.r);
      loY[n] = Math.max(top - b0.t, Math.min(0, top + 2 * sigma - ay));
      hiY[n] = Math.max(loY[n], Math.min(H - edge - b0.b, Math.max(0, H - 2 * sigma - ay)));
    }
    function box(i) { return boxAt(i, anchors[i][0] * W + offX[i], anchors[i][1] * H + offY[i]); }
    function overlap(a, b, m) { return [Math.min(a.r, b.r) - Math.max(a.l, b.l) + m, Math.min(a.b, b.b) - Math.max(a.t, b.t) + m]; }
    // share a move of o between i (towards lower values) and j (towards higher), half each where both have room
    function share(o, off, lo, hi, i, j) {
      var ri = Math.max(0, off[i] - lo[i]), rj = Math.max(0, hi[j] - off[j]);
      var mi = Math.min(o / 2, ri), mj = Math.min(o - mi, rj); mi = Math.min(o - mj, ri);
      return { mi: mi, mj: mj, cost: Math.max(mi, mj) + 4 * (o - mi - mj) };
    }
    for (var it = 0; it < 12; it++) {
      var moved = false;
      for (var i = 0; i < N; i++) {
        for (var j = i + 1; j < N; j++) {
          var a = box(i), b = box(j), o = overlap(a, b, gapMin + 2 * drift);
          if (o[0] <= 0.5 || o[1] <= 0.5) continue;
          var li = a.l + a.r < b.l + b.r, ti = a.t + a.b < b.t + b.b;
          var hx = li ? share(o[0], offX, loX, hiX, i, j) : share(o[0], offX, loX, hiX, j, i);
          var vy = ti ? share(o[1], offY, loY, hiY, i, j) : share(o[1], offY, loY, hiY, j, i);
          if (hx.cost <= vy.cost) { offX[li ? i : j] -= hx.mi; offX[li ? j : i] += hx.mj; }
          else { offY[ti ? i : j] -= vy.mi; offY[ti ? j : i] += vy.mj; }
          moved = true;
        }
        for (var k = 0; k < fixed.length; k++) {
          var c = box(i), f = fixed[k], q = overlap(c, f, gapMin + drift);
          if (q[0] <= 0.5 || q[1] <= 0.5) continue;
          if (q[0] < q[1]) offX[i] += c.l + c.r < f.l + f.r ? -q[0] : q[0];
          else offY[i] += c.t + c.b < f.t + f.b ? -q[1] : q[1];
          moved = true;
        }
        offX[i] = Math.min(hiX[i], Math.max(loX[i], offX[i]));
        offY[i] = Math.min(hiY[i], Math.max(loY[i], offY[i]));
      }
      if (!moved) break;
    }
  }
  // the bar's logo, links and buttons get the same gaps while the bar is see-through (home page only)
  var barBox = [];
  function measureBar() {
    var b = document.getElementById('bar');
    barBox = [];
    if (still || !b) return;
    b.querySelectorAll('.brand svg, nav a, .tools .iconbtn').forEach(function (el) {
      var r = el.getBoundingClientRect(); if (r.width) barBox.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    });
  }
  function clearLabels() {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000'; ctx.shadowColor = '#000'; ctx.shadowBlur = 14 * dpr;
    var b = document.getElementById('bar');
    if (barBox.length && b && !b.classList.contains('is-solid')) {
      var sy = window.scrollY - hero.offsetTop;
      for (var q = 0; q < barBox.length; q++) { var bb = barBox[q]; ctx.fillRect(bb.x - 6, bb.y + sy - 2, bb.w + 12, bb.h + 4); }
    }
    for (var i = 0; i < lblBox.length; i++) {
      var bx = lblBox[i]; if (!bx.w) continue;
      var left = bx.left ? cx[i] + 15.5 - bx.ew - 4 : cx[i] - 7.5 - 4;
      var x = left + bx.ox, y = cy[i] - 9.5 - 4 + bx.oy;
      ctx.fillRect(x - 6, y - 2, bx.w + 12, bx.h + 4);
    }
    ctx.restore();
  }

  // ---------------- Contours (marching squares) ----------------
  var grid = null, cols = 0, rows = 0, colSin = null, colCos = null;
  function allocGrid() {
    cols = Math.ceil(W / cell) + 1; rows = Math.ceil(H / cell) + 1;
    grid = new Float64Array(cols * rows);
  }
  function fillGrid() {
    for (var j = 0; j < rows; j++) {
      var y = j * cell, base = j * cols;
      for (var i = 0; i < cols; i++) grid[base + i] = psiAt(i * cell, y);
    }
  }
  // emits the segment(s) of level L inside cell (i, j), without allocating
  function cellSegments(i, j, L, path) {
    var x0 = i * cell, y0 = j * cell, x1 = x0 + cell, y1 = y0 + cell;
    var a = grid[j * cols + i], b = grid[j * cols + i + 1], c = grid[(j + 1) * cols + i + 1], d = grid[(j + 1) * cols + i];
    var idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
    if (idx === 0 || idx === 15) return;
    var tX, rY, bX, lY, mid;
    switch (idx) {
      case 1: case 14: lY = y0 + cell * (L - a) / (d - a); bX = x0 + cell * (L - d) / (c - d); path.moveTo(x0, lY); path.lineTo(bX, y1); break;
      case 2: case 13: bX = x0 + cell * (L - d) / (c - d); rY = y0 + cell * (L - b) / (c - b); path.moveTo(bX, y1); path.lineTo(x1, rY); break;
      case 3: case 12: lY = y0 + cell * (L - a) / (d - a); rY = y0 + cell * (L - b) / (c - b); path.moveTo(x0, lY); path.lineTo(x1, rY); break;
      case 4: case 11: tX = x0 + cell * (L - a) / (b - a); rY = y0 + cell * (L - b) / (c - b); path.moveTo(tX, y0); path.lineTo(x1, rY); break;
      case 6: case 9: tX = x0 + cell * (L - a) / (b - a); bX = x0 + cell * (L - d) / (c - d); path.moveTo(tX, y0); path.lineTo(bX, y1); break;
      case 7: case 8: tX = x0 + cell * (L - a) / (b - a); lY = y0 + cell * (L - a) / (d - a); path.moveTo(tX, y0); path.lineTo(x0, lY); break;
      case 5: case 10:
        tX = x0 + cell * (L - a) / (b - a); rY = y0 + cell * (L - b) / (c - b);
        bX = x0 + cell * (L - d) / (c - d); lY = y0 + cell * (L - a) / (d - a);
        mid = (a + b + c + d) / 4 > L;
        if ((idx === 5) === mid) { path.moveTo(tX, y0); path.lineTo(x0, lY); path.moveTo(bX, y1); path.lineTo(x1, rY); }
        else { path.moveTo(tX, y0); path.lineTo(x1, rY); path.moveTo(x0, lY); path.lineTo(bX, y1); }
        break;
    }
  }
  function drawCurves() {
    fillGrid();
    var base = new Path2D(), hot = new Path2D(), sep = new Path2D();
    var h = hovered, hs = h >= 0 ? sad[h] : null, hR2 = 0, hLo = 0, hHi = 0;
    if (hs) { hR2 = hs.R * hs.R * 1.05; hLo = Math.min(hs.psi, hs.psiC); hHi = Math.max(hs.psi, hs.psiC); }
    for (var j = 0; j < rows - 1; j++) {
      for (var i = 0; i < cols - 1; i++) {
        var a = grid[j * cols + i], b = grid[j * cols + i + 1], c = grid[(j + 1) * cols + i + 1], d = grid[(j + 1) * cols + i];
        var mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
        var k0 = Math.ceil(mn / gap), k1 = Math.floor(mx / gap);
        if (k1 < k0) continue;
        var inHot = false;
        if (hs) { var ddx = (i + 0.5) * cell - cx[h], ddy = (j + 0.5) * cell - cy[h]; inHot = ddx * ddx + ddy * ddy < hR2; }
        for (var k = k0; k <= k1; k++) {
          var L = k * gap;
          cellSegments(i, j, L, inHot && L > hLo && L < hHi ? hot : base);
        }
      }
    }
    // separatrices: the level set through each saddle, drawn around its own island
    for (var s = 0; s < N; s++) {
      var sd = sad[s]; if (!sd.ok) continue;
      var reach = 1.7 * sd.R, L2 = sd.psi;
      var i0 = Math.max(0, Math.floor((cx[s] - reach) / cell)), i1 = Math.min(cols - 2, Math.ceil((cx[s] + reach) / cell));
      var j0 = Math.max(0, Math.floor((cy[s] - reach) / cell)), j1 = Math.min(rows - 2, Math.ceil((cy[s] + reach) / cell));
      for (var j2 = j0; j2 <= j1; j2++) {
        for (var i2 = i0; i2 <= i1; i2++) {
          var a2 = grid[j2 * cols + i2], b2 = grid[j2 * cols + i2 + 1], c2 = grid[(j2 + 1) * cols + i2 + 1], d2 = grid[(j2 + 1) * cols + i2];
          if (L2 > Math.min(a2, b2, c2, d2) && L2 < Math.max(a2, b2, c2, d2)) cellSegments(i2, j2, L2, sep);
        }
      }
    }
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = 1; ctx.strokeStyle = inkA(col.dark ? 0.30 : 0.27); ctx.stroke(base);
    ctx.strokeStyle = col.accent; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.2; ctx.stroke(sep);
    ctx.globalAlpha = 1; ctx.lineWidth = 1.2; ctx.stroke(hot);
    // saddles, marked as small open circles
    ctx.lineWidth = 1.25;
    for (var m = 0; m < N; m++) if (sad[m].ok) { ctx.beginPath(); ctx.arc(sad[m].x, sad[m].y, 3.5, 0, 2 * Math.PI); ctx.stroke(); }
    clearLabels();
  }

  // ---------------- Flow (tracer particles) ----------------
  // Away from the destination the flow is conservative: particles circulate along the level curves.
  // Pointing at a destination adds friction along the gradient there, s*gamma*grad(psi), which turns that
  // centre into a stable focus: trajectories spiral in, crossing the level curves at a small constant angle.
  var GAMMA_F = 0.2;   // Flow: friction at the destination you point at
  var gammaNow = 0, lastIsl = -1;
  var P = 0, TL = 26, px = null, py = null, age = null, life = null, len = null, hist = null, head = 0;
  function initParticles() {
    P = Math.min(1600, Math.round(W * H / (phone ? 700 : 850)));
    px = new Float32Array(P); py = new Float32Array(P); age = new Float32Array(P); life = new Float32Array(P);
    len = new Uint8Array(P); hist = new Float32Array(P * TL * 2); head = 0;
    for (var p = 0; p < P; p++) respawn(p, true);
  }
  function respawn(p, anywhere) {
    if (anywhere || Math.random() < 0.6) { px[p] = Math.random() * W; py[p] = Math.random() * H; }
    else { px[p] = -4; py[p] = Math.random() * H; }
    age[p] = 0; life[p] = 240 + Math.random() * 420; len[p] = 0;
  }
  // 1 inside the island's separatrix loop, easing to 0 just outside it
  function islandWeight(i, x, y) {
    var R = sad[i].R || 2 * sigma;
    var dx = x - cx[i], dy = y - cy[i], r = Math.sqrt(dx * dx + dy * dy) / R;
    if (r <= 0.85) return 1;
    if (r >= 1.25) return 0;
    var u = (r - 0.85) / 0.4; return 1 - u * u * (3 - 2 * u);
  }
  function velocity(x, y, out, gamma, isl) {
    gradAt(x, y, out);
    var gx = out[0], gy = out[1], u = gy, v = -gx;
    if (isl >= 0 && gamma > 0) {
      var w = islandWeight(isl, x, y);
      if (w > 0) { var k = sgn[isl] * gamma * w; u += k * gx; v += k * gy; }
    }
    out[0] = u; out[1] = v; return out;
  }
  var k1 = [0, 0], k2 = [0, 0], k3 = [0, 0], k4 = [0, 0], rr = [0, 0];
  function rk4(x, y, h, gamma, isl, res) {
    velocity(x, y, k1, gamma, isl);
    velocity(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], k2, gamma, isl);
    velocity(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], k3, gamma, isl);
    velocity(x + h * k3[0], y + h * k3[1], k4, gamma, isl);
    res[0] = x + h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
    res[1] = y + h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
  }
  // frame time -> number of RK4 sub-steps, so a slow frame never becomes one long straight step
  function stepping(dt) { var f = Math.min(3, dt / 16.67) * 1.15, n = Math.max(1, Math.ceil(f / 1.2)); return [f, n, f / n]; }
  function stepParticles(dt) {
    var s = stepping(dt), f = s[0], n = s[1], h = s[2], isl = lastIsl, g = gammaNow;
    head = (head + 1) % TL;
    for (var p = 0; p < P; p++) {
      var x = px[p], y = py[p];
      for (var k = 0; k < n; k++) { rk4(x, y, h, g, isl, rr); x = rr[0]; y = rr[1]; }
      age[p] += f;
      var captured = false;
      if (isl >= 0 && g > 0.05) { var cdx = x - cx[isl], cdy = y - cy[isl], cr = 0.08 * (sad[isl].R || 2 * sigma); captured = cdx * cdx + cdy * cdy < cr * cr; }
      if (x > W + 20 || x < -30 || y < -30 || y > H + 30 || age[p] > life[p] || captured) { respawn(p, false); x = px[p]; y = py[p]; }
      px[p] = x; py[p] = y;
      var o = (p * TL + head) * 2; hist[o] = x; hist[o + 1] = y;
      if (len[p] < TL) len[p]++;
    }
  }
  function polyline(path, H2, T2, hd, p, n) {
    var k = hd, o = (p * T2 + k) * 2;
    path.moveTo(H2[o], H2[o + 1]);
    for (var s = 1; s < n; s++) { k = (k - 1 + T2) % T2; o = (p * T2 + k) * 2; path.lineTo(H2[o], H2[o + 1]); }
  }
  function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    var base = new Path2D(), hot = new Path2D();
    var isl = lastIsl, showHot = isl >= 0 && gammaNow > 0.02;
    for (var p = 0; p < P; p++) {
      if (len[p] < 2) continue;
      polyline(showHot && islandWeight(isl, px[p], py[p]) > 0.5 ? hot : base, hist, TL, head, p, len[p]);
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 1;
    ctx.strokeStyle = inkA(col.dark ? 0.34 : 0.30); ctx.stroke(base);
    if (showHot) {
      ctx.strokeStyle = col.stable; ctx.globalAlpha = Math.min(1, gammaNow / GAMMA_F) * 0.95; ctx.lineWidth = 1.15;
      ctx.stroke(hot); ctx.globalAlpha = 1;
    }
    clearLabels();
  }
  // still pictures, for reduced motion or a paused page
  function traceSpirals(i, path, gamma) {
    var R = sad[i].R || 2 * sigma;
    for (var a = 0; a < 12; a++) {
      var th = a / 12 * 2 * Math.PI, x = cx[i] + 0.9 * R * Math.cos(th), y = cy[i] + 0.9 * R * Math.sin(th);
      if (sad[i].ok && !insideIsland(i, x, y)) continue;
      path.moveTo(x, y);
      for (var s = 0; s < 2400; s++) {
        rk4(x, y, 1.2, gamma, i, rr); x = rr[0]; y = rr[1]; path.lineTo(x, y);
        if (Math.abs(x - cx[i]) + Math.abs(y - cy[i]) < 0.08 * R) break;
      }
    }
  }
  function drawStreamlines() {
    ctx.clearRect(0, 0, W, H);
    var base = new Path2D(), g = [0, 0];
    function trace(x, y, steps, path) {
      path.moveTo(x, y);
      for (var s = 0; s < steps; s++) {
        gradAt(x, y, g); var u = g[1], v = -g[0], m = Math.hypot(u, v) || 1;
        x += 2.2 * u / m; y += 2.2 * v / m;
        if (x > W + 10 || x < -10 || y < -10 || y > H + 10) break;
        path.lineTo(x, y);
      }
    }
    for (var yy = gap * 0.5; yy < H; yy += gap * 1.6) trace(-5, yy, 1400, base);
    for (var i = 0; i < N; i++) for (var r = 0.35; r < 1.4; r += 0.33) trace(cx[i], cy[i] + r * sigma, 260, base);
    ctx.lineWidth = 1; ctx.strokeStyle = inkA(col.dark ? 0.30 : 0.27); ctx.stroke(base);
    if (hovered >= 0) { var sp = new Path2D(); traceSpirals(hovered, sp, GAMMA_F); ctx.strokeStyle = col.stable; ctx.lineWidth = 1.15; ctx.stroke(sp); }
    clearLabels();
  }

  function insideIsland(i, x, y) {
    var sd = sad[i], d = Math.hypot(x - cx[i], y - cy[i]);
    if (!sd.ok) return d < 1.4 * sigma;
    var v = psiAt(x, y), lo = Math.min(sd.psi, sd.psiC), hi = Math.max(sd.psi, sd.psiC);
    return v > lo && v < hi && d < sd.R * 1.05;
  }

  // ---------------- Frame loop ----------------
  function ease(cur, target, dt, ms) { return cur + (target - cur) * (1 - Math.exp(-dt / ms)); }
  function update(dt) {
    var grow = mode === 'curves' ? 1.3 : 1.15;
    for (var i = 0; i < N; i++) gf[i] = ease(gf[i], i === hovered ? grow : 1, dt, 160);
    if (hovered >= 0) lastIsl = hovered;
    gammaNow = ease(gammaNow, hovered >= 0 ? GAMMA_F : 0, dt, 260);
    ptr.x = ease(ptr.x, ptr.tx, dt, 70); ptr.y = ease(ptr.y, ptr.ty, dt, 70);
    // the pointer's bump fades out near any destination, so a link never runs away from the cursor
    var near = Infinity;
    for (var k = 0; k < N; k++) near = Math.min(near, Math.hypot(ptr.tx - cx[k], ptr.ty - cy[k]));
    var fade = Math.max(0, Math.min(1, (near - 1.3 * sigma) / sigma));
    ptr.a = ease(ptr.a, ptr.ta * fade, dt, 140);
    pmx = ptr.x; pmy = ptr.y; pG = ptr.a > 0.002 ? ptr.a * 1.3 * SM : 0;
    ph = t * omega;
    positionCentres();
    findSaddles();
  }
  function moving() { return !reduceMQ.matches && !paused && onScreen && pageVisible; }
  var flowHasRun = false;
  function draw(dt) {
    readColours();   // cheap, and it keeps the field in step with the page whatever changed the theme
    if (mode === 'curves') drawCurves();
    else if (moving()) { stepParticles(dt); drawParticles(); flowHasRun = true; }
    else if (flowHasRun && paused) drawParticles();
    else drawStreamlines();
  }
  function frame(now) {
    raf = 0;
    if (!moving()) return;
    var dt = Math.min(50, now - last); last = now;
    if (mode === 'curves' && now - lastDraw < 24) { t += dt / 1000; raf = requestAnimationFrame(frame); return; }
    t += dt / 1000; lastDraw = now;
    update(dt); draw(dt);
    raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (moving()) { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    else { update(1000); draw(0); }
  }

  // ---------------- Interaction ----------------
  hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect();
    ptr.tx = e.clientX - r.left; ptr.ty = e.clientY - r.top; ptr.ta = 1;
    if (ptr.x < -1000) { ptr.x = ptr.tx; ptr.y = ptr.ty; }
    stillHover();
    if (!moving()) kick();
  });
  hero.addEventListener('pointerleave', function () { ptr.ta = 0; stillHover(); if (!moving()) kick(); });
  // on an inner page, pointing near the equilibrium does what hovering a destination does on the home page
  function stillHover() {
    if (!still) return;
    var d = Math.hypot(ptr.tx - cx[0], ptr.ty - cy[0]);
    var h = ptr.ta > 0 && d < (hovered === 0 ? 2.0 : 1.4) * sigma ? 0 : -1;
    if (h !== hovered) { hovered = h; eqEls[0].classList.toggle('is-on', h === 0); }
  }
  if (!still) eqEls.forEach(function (el, i) {
    function on() { hovered = i; el.classList.add('is-on'); kick(); }
    function off() { if (hovered === i) hovered = -1; el.classList.remove('is-on'); kick(); }
    el.addEventListener('pointerenter', on); el.addEventListener('pointerleave', off);
    el.addEventListener('focus', on); el.addEventListener('blur', off);
  });

  // Curves with red, or (for the curious) flow with blue. Never stored: every visit starts on the curves.
  var flowBtn = document.getElementById('flowbtn');
  function setMode(m) {
    mode = m;
    root.setAttribute('data-jpe-field', m);
    root.setAttribute('data-jpe-accent', m === 'flow' ? 'blue' : 'red');
    var label = m === 'flow' ? 'Show the level curves' : 'Show the flow';
    flowBtn.setAttribute('aria-pressed', String(m === 'flow'));
    flowBtn.setAttribute('aria-label', label); flowBtn.title = label;
    if (m === 'flow') { initParticles(); flowHasRun = false; }
    store('jpe-field', m === 'flow' ? 'flow' : null, 'session');
    readColours();
    kick();
  }
  flowBtn.addEventListener('click', function () { setMode(mode === 'flow' ? 'curves' : 'flow'); });

  // Pause: moving content that runs for more than five seconds needs a way to stop it
  var holdBtn = document.getElementById('hold');
  holdBtn.addEventListener('click', function () {
    paused = !paused;
    var label = paused ? 'Play the animation' : 'Pause the animation';
    holdBtn.setAttribute('aria-pressed', String(paused)); holdBtn.setAttribute('aria-label', label); holdBtn.title = label;
    kick();
  });
  reduceMQ.addEventListener && reduceMQ.addEventListener('change', kick);

  // Theme: follow the system unless the visitor picks the other one; picking the system's own choice clears the override
  var themeBtn = document.getElementById('theme');
  function labelTheme() { themeBtn.setAttribute('aria-label', themeNow() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); }
  themeBtn.addEventListener('click', function () {
    var next = themeNow() === 'dark' ? 'light' : 'dark';
    var sys = darkMQ.matches ? 'dark' : 'light';
    root.setAttribute('data-jpe-theme', next);
    store('jpe-theme', next === sys ? null : next);
    readColours(); labelTheme(); kick();
  });
  darkMQ.addEventListener && darkMQ.addEventListener('change', function () { if (!load('jpe-theme')) root.removeAttribute('data-jpe-theme'); readColours(); labelTheme(); kick(); });

  // Bar: it always stays. On the home page it condenses into a solid strip once the masthead has gone;
  // on inner pages it is solid from the start.
  var bar = document.getElementById('bar');
  function onScroll() {
    if (still) return;
    bar.classList.toggle('is-solid', window.scrollY > hero.offsetHeight - 120);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { onScreen = entries[0].isIntersecting; kick(); }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () { pageVisible = !document.hidden; kick(); });
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { layout(); kick(); }, 120); });
  // a viewer may start the page hidden or at another size: lay the field out again whenever its box changes
  if ('ResizeObserver' in window) {
    var boxW = -1, boxH = -1;
    new ResizeObserver(function (es) {
      var r = es[0].contentRect;
      if (Math.abs(r.width - boxW) > 1 || Math.abs(r.height - boxH) > 1) { boxW = r.width; boxH = r.height; clearTimeout(rt); rt = setTimeout(function () { layout(); kick(); }, 60); }
    }).observe(hero);
  }
  window.addEventListener('pageshow', function () { readColours(); labelTheme(); kick(); });

  // List reveal: rows below the fold rise into place once, as they come into view
  var rowEls = Array.prototype.slice.call(document.querySelectorAll('.rows li, .tiles li'));
  rowEls.forEach(function (li) { li.style.setProperty('--i', Array.prototype.indexOf.call(li.parentNode.children, li)); });
  function startReveal() {
    if (!('IntersectionObserver' in window)) { rowEls.forEach(function (li) { li.classList.add('in'); }); return; }
    var rowIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); rowIO.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.2 });
    rowEls.forEach(function (li) {
      if (li.getBoundingClientRect().top < window.innerHeight * 0.9) li.classList.add('in'); else rowIO.observe(li);
    });
  }

  // ---------------- Start ----------------
  readColours(); labelTheme();
  layout();
  // the field always starts on the curves; after that it keeps the visitor's choice from page to page until a refresh
  var savedMode = navType === 'reload' ? null : load('jpe-field', 'session');
  setMode(savedMode === 'flow' ? 'flow' : 'curves');

  onScroll();
  startReveal();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { arrange(); kick(); });
  // once everything has loaded (styles included), read the colours and sizes again
  window.addEventListener('load', function () { readColours(); labelTheme(); layout(); kick(); });
})();
