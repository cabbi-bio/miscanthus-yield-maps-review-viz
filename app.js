/* Miscanthus yield map comparison
 * Vanilla JS + D3 v7. Data comes from yield_data.js (window.YIELD_DATA),
 * exported from the extracted_yield.nc files with ncdf4.
 *
 * Each dataset is a regular lon/lat grid stored sparsely:
 *   idx[k] = i + j * nlon   (0-based, i indexes lon, j indexes lat)
 *   val[k] = value at that cell
 * Cell centres are lon0 + i*dlon, lat0 + j*dlat.
 */
'use strict';

// ---------------------------------------------------------------- constants

var DAVIS_TO_MGHA = 0.0222;   // g C m-2 yr-1 -> Mg DM ha-1 yr-1 at 45% C

var EXTENTS = {
  world:    [-180, -60, 180, 85],
  conus:    [-126, 23.5, -66, 50.5],
  midwest:  [-105, 35.5, -79, 49.5],
  illinois: [-92.5, 36, -86.5, 43.5]
};

var LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json';
var STATES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

// ---------------------------------------------------------------- state

var DATA = (window.YIELD_DATA || []).map(prepare);
// A dataset is usable only if it holds data AND that data is its own — see the
// duplicate check in export_json.R.
var WITH_DATA = DATA.filter(function (d) { return d.n_valid > 0 && !d.dup_of; });
var EMPTY = DATA.filter(function (d) { return d.n_valid === 0; });
var SUSPECT = DATA.filter(function (d) { return d.n_valid > 0 && d.dup_of; });

var state = {
  mode: 'single',
  a: WITH_DATA.length ? WITH_DATA[0].key : null,
  b: WITH_DATA.length > 1 ? WITH_DATA[1].key : null,
  proj: 'equirectangular',
  extent: 'auto',
  ramp: 'brbg',
  domain: 'self',
  coast: true,
  grat: true,
  cells: false,
  davis: true,
  overlay: '',
  transform: d3.zoomIdentity
};

var world = { land: null, states: null, failed: false };
var panes = {};       // wrapId -> pane object

// ---------------------------------------------------------------- data prep

function prepare(d) {
  var n = d.nlon * d.nlat;
  var g = new Float64Array(n);
  g.fill(NaN);
  var idx = d.idx || [];
  var val = d.val || [];
  for (var k = 0; k < idx.length; k++) g[idx[k]] = val[k];
  d.grid = g;
  d.isDavis = /g C m-2/.test(d.units || '');
  d.short = (d.study || d.key).replace(/ et al\.,/, '');

  // 2nd and 98th percentile of the valid values, for the robust colour domain
  var sorted = Float64Array.from(val).sort();
  d.p02 = sorted.length ? sorted[Math.floor(0.02 * (sorted.length - 1))] : 0;
  d.p98 = sorted.length ? sorted[Math.floor(0.98 * (sorted.length - 1))] : 1;

  // bounding box of cells that actually carry data
  if (idx.length) {
    var i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (var m = 0; m < idx.length; m++) {
      var i = idx[m] % d.nlon, j = (idx[m] - i) / d.nlon;
      if (i < i0) i0 = i; if (i > i1) i1 = i;
      if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    d.bbox = [
      d.lon0 + (i0 - 0.5) * d.dlon, d.lat0 + (j0 - 0.5) * d.dlat,
      d.lon0 + (i1 + 0.5) * d.dlon, d.lat0 + (j1 + 0.5) * d.dlat
    ];
  } else {
    d.bbox = [d.lon0, d.lat0,
              d.lon0 + d.nlon * d.dlon, d.lat0 + d.nlat * d.dlat];
  }
  return d;
}

function byKey(k) {
  for (var i = 0; i < DATA.length; i++) if (DATA[i].key === k) return DATA[i];
  return null;
}

/** Scale factor applied to a dataset's stored values for display. */
function unitFactor(d) {
  return (d.isDavis && state.davis) ? DAVIS_TO_MGHA : 1;
}

function unitLabel(d) {
  if (d.isDavis && state.davis) return 'Mg ha⁻¹';
  return (d.units || '').replace('Mg ha-1', 'Mg ha⁻¹')
                        .replace('g C m-2 yr-1', 'g C m⁻² yr⁻¹');
}

/** Nearest-cell lookup. Returns NaN outside the grid or on missing cells. */
function sample(d, lon, lat) {
  var i = Math.round((lon - d.lon0) / d.dlon);
  var j = Math.round((lat - d.lat0) / d.dlat);
  if (i < 0 || i >= d.nlon || j < 0 || j >= d.nlat) return NaN;
  return d.grid[i + j * d.nlon];
}

function sampleDisplay(d, lon, lat) {
  return sample(d, lon, lat) * unitFactor(d);
}

// ---------------------------------------------------------------- colour
//
// Yield is a magnitude, so it gets a sequential ramp. Viridis is the default
// because it is perceptually uniform and CVD-safe across the wide dynamic
// range these maps span; the single-hue blue ramp is offered as the
// design-system alternative. Differences are signed, so they get a diverging
// blue<->red ramp with a neutral grey midpoint, always centred on zero.

function seqRamp(t) {
  switch (state.ramp) {
    // BrBG runs brown (dry, low-yielding) to blue-green (productive), which
    // reads the right way round for yield. Its midpoint is near-white, so the
    // map background is the warm --nodata grey rather than the panel white —
    // otherwise mid-range cells would be mistaken for holes in the data.
    case 'brbg':   return d3.interpolateBrBG(0.04 + 0.92 * t);
    case 'turbo':  return d3.interpolateTurbo(1 - t);
    case 'blues':  return d3.interpolateBlues(0.12 + 0.88 * t);
    default:       return d3.interpolateViridis(t);
  }
}

function divRamp(t) {
  // blue (negative) -> neutral grey -> red (positive); poles and midpoint come
  // from CSS so the ramp is stepped for whichever theme is active
  var css = getComputedStyle(document.body);
  var lo = css.getPropertyValue('--div-lo').trim() || '#184f95';
  var mid = css.getPropertyValue('--div-mid').trim() || '#f0efec';
  var hi = css.getPropertyValue('--div-hi').trim() || '#a11d1c';
  return t < 0.5 ? d3.interpolateLab(lo, mid)(t * 2)
                 : d3.interpolateLab(mid, hi)((t - 0.5) * 2);
}

function domainFor(d) {
  var f = unitFactor(d);
  if (state.domain === 'shared') return [0, 40];
  if (state.domain === 'robust') return [d.p02 * f, d.p98 * f];
  return [d.vmin * f, d.vmax * f];
}

function colorFnFor(d) {
  var dom = domainFor(d);
  var s = d3.scaleLinear().domain(dom).range([0, 1]).clamp(true);
  var fn = function (v) { return seqRamp(s(v)); };
  fn.domain = dom;
  fn.diverging = false;
  return fn;
}

function diffColorFn(maxAbs) {
  var s = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([0, 1]).clamp(true);
  var fn = function (v) { return divRamp(s(v)); };
  fn.domain = [-maxAbs, maxAbs];
  fn.diverging = true;
  return fn;
}

// ---------------------------------------------------------------- projection

function bboxFor(d) {
  if (state.extent !== 'auto') return EXTENTS[state.extent];
  if (!d) return EXTENTS.world;
  var b = d.bbox.slice();
  var padx = Math.max(1, (b[2] - b[0]) * 0.03);
  var pady = Math.max(1, (b[3] - b[1]) * 0.03);
  return [b[0] - padx, b[1] - pady, b[2] + padx, b[3] + pady];
}

function makeProjection(bbox, w, h) {
  var name = state.proj;
  var proj;
  if (name === 'albersUsa') proj = d3.geoAlbersUsa();
  else if (name === 'conicEqualArea') {
    proj = d3.geoConicEqualArea()
      .parallels([29.5, 45.5])
      .rotate([(bbox[0] + bbox[2]) / -2, 0]);
  } else proj = d3['geo' + name[0].toUpperCase() + name.slice(1)]();

  // Fit against a densified ring of POINTS rather than a Polygon: a polygon
  // spanning more than a hemisphere is ambiguous on the sphere and d3 fits
  // its complement, which silently blows up the scale on the global maps.
  var pts = [];
  var N = 24;
  for (var s = 0; s <= N; s++) {
    var fx = bbox[0] + (bbox[2] - bbox[0]) * s / N;
    var fy = bbox[1] + (bbox[3] - bbox[1]) * s / N;
    pts.push([fx, bbox[1]], [fx, bbox[3]], [bbox[0], fy], [bbox[2], fy]);
  }
  var pad = 6;
  try {
    proj.fitExtent([[pad, pad], [Math.max(w - pad, pad + 1),
                                 Math.max(h - pad, pad + 1)]],
                   { type: 'MultiPoint', coordinates: pts });
  } catch (e) { /* degenerate size during layout — ignore */ }
  return proj;
}

// ---------------------------------------------------------------- pane

/** Create (or reuse) a map pane inside the element with the given id. */
function pane(wrapId, opts) {
  if (panes[wrapId]) return panes[wrapId];
  var wrap = document.getElementById(wrapId);
  var canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  var svg = d3.select(wrap).append('svg');

  var p = {
    id: wrapId, wrap: wrap, canvas: canvas, ctx: canvas.getContext('2d'),
    svg: svg, interactive: !opts || opts.interactive !== false,
    layers: null, proj: null, w: 0, h: 0
  };

  p.gGrat = svg.append('g').attr('class', 'l-grat');
  p.gLand = svg.append('g').attr('class', 'l-land');
  p.gState = svg.append('g').attr('class', 'l-state');
  p.gOver = svg.append('g').attr('class', 'l-over');

  if (p.interactive) {
    d3.select(canvas)
      .call(d3.zoom().scaleExtent([1, 200]).on('zoom', function (ev) {
        state.transform = ev.transform;
        renderAll();
      }))
      .on('mousemove', function (ev) { onHover(p, ev); })
      .on('mouseleave', hideTip);
  }

  panes[wrapId] = p;
  return p;
}

function sizePane(p) {
  var r = p.wrap.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  p.w = Math.max(1, Math.round(r.width));
  p.h = Math.max(1, Math.round(r.height));
  p.canvas.width = Math.round(p.w * dpr);
  p.canvas.height = Math.round(p.h * dpr);
  p.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  p.svg.attr('viewBox', '0 0 ' + p.w + ' ' + p.h);
}

// ---------------------------------------------------------------- rendering

/** A "layer" is one grid + one colour function + a label. */
function layerFor(d) {
  return {
    kind: 'grid', ds: d, color: colorFnFor(d), factor: unitFactor(d),
    label: d.short, units: unitLabel(d)
  };
}

/** Build the A-minus-B difference layer on the coarser of the two grids. */
function diffLayer(A, B) {
  if (!A || !B) return null;
  var G = Math.abs(A.dlon) >= Math.abs(B.dlon) ? A : B;
  var fa = unitFactor(A), fb = unitFactor(B);
  var n = G.nlon * G.nlat;
  var grid = new Float64Array(n);
  grid.fill(NaN);

  var vals = [], onlyA = 0, onlyB = 0, both = 0;
  for (var j = 0; j < G.nlat; j++) {
    var lat = G.lat0 + j * G.dlat;
    for (var i = 0; i < G.nlon; i++) {
      var lon = G.lon0 + i * G.dlon;
      var va = sample(A, lon, lat), vb = sample(B, lon, lat);
      var ha = !isNaN(va), hb = !isNaN(vb);
      if (ha && hb) {
        var dv = va * fa - vb * fb;
        grid[i + j * G.nlon] = dv;
        vals.push(dv);
        both++;
      } else if (ha) onlyA++;
      else if (hb) onlyB++;
    }
  }

  var maxAbs = 1;
  if (vals.length) {
    var s = Float64Array.from(vals, Math.abs).sort();
    maxAbs = s[Math.floor(0.98 * (s.length - 1))] || 1;
  }

  var pseudo = {
    key: '__diff', lon0: G.lon0, dlon: G.dlon, nlon: G.nlon,
    lat0: G.lat0, dlat: G.dlat, nlat: G.nlat, grid: grid,
    bbox: overlapBox(A.bbox, B.bbox)
  };

  return {
    kind: 'diff', ds: pseudo, color: diffColorFn(maxAbs), factor: 1,
    label: A.short + ' − ' + B.short, units: 'Mg ha⁻¹',
    stats: { both: both, onlyA: onlyA, onlyB: onlyB, vals: vals,
             A: A, B: B, grid: G }
  };
}

function overlapBox(a, b) {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]),
          Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

/** Draw one layer's grid cells onto the canvas of pane p. */
function drawGrid(p, layer) {
  var ctx = p.ctx, d = layer.ds, proj = p.proj, t = state.transform;
  var f = layer.factor, color = layer.color;
  var w = p.w, h = p.h;

  ctx.save();
  // Zoom is a pure affine on the projected plane, so pan/zoom never
  // reprojects — the cells and the coastlines stay locked together.
  ctx.translate(t.x, t.y);
  ctx.scale(t.k, t.k);

  var hx = d.dlon / 2, hy = d.dlat / 2;
  var margin = 40 / t.k;
  var showEdges = state.cells && t.k > 6;

  for (var j = 0; j < d.nlat; j++) {
    var lat = d.lat0 + j * d.dlat;
    for (var i = 0; i < d.nlon; i++) {
      var v = d.grid[i + j * d.nlon];
      if (isNaN(v)) continue;
      var lon = d.lon0 + i * d.dlon;

      var a = proj([lon - hx, lat - hy]);
      var b = proj([lon + hx, lat - hy]);
      var c = proj([lon + hx, lat + hy]);
      var e = proj([lon - hx, lat + hy]);
      if (!a || !b || !c || !e) continue;

      // cheap frustum cull in screen space
      var sx = a[0] * t.k + t.x, sy = a[1] * t.k + t.y;
      if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) {
        var sx2 = c[0] * t.k + t.x, sy2 = c[1] * t.k + t.y;
        if (sx2 < -margin || sx2 > w + margin ||
            sy2 < -margin || sy2 > h + margin) continue;
      }

      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(e[0], e[1]);
      ctx.closePath();
      ctx.fillStyle = color(v * f);
      ctx.fill();
      // hairline stroke in the same colour closes the seams antialiasing
      // leaves between adjacent quads
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6 / t.k;
      ctx.stroke();
    }
  }

  if (showEdges) {
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.lineWidth = 0.5 / t.k;
    for (var jj = 0; jj < d.nlat; jj++) {
      var la = d.lat0 + jj * d.dlat;
      for (var ii = 0; ii < d.nlon; ii++) {
        if (isNaN(d.grid[ii + jj * d.nlon])) continue;
        var lo = d.lon0 + ii * d.dlon;
        var q1 = proj([lo - hx, la - hy]), q2 = proj([lo + hx, la - hy]),
            q3 = proj([lo + hx, la + hy]), q4 = proj([lo - hx, la + hy]);
        if (!q1 || !q2 || !q3 || !q4) continue;
        ctx.beginPath();
        ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]);
        ctx.lineTo(q3[0], q3[1]); ctx.lineTo(q4[0], q4[1]);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

function drawPane(p, layer, focusDs) {
  sizePane(p);
  p.layer = layer;
  p.proj = makeProjection(bboxFor(focusDs || (layer && layer.ds)), p.w, p.h);

  var css = getComputedStyle(document.body);
  p.ctx.clearRect(0, 0, p.w, p.h);
  p.ctx.fillStyle = css.getPropertyValue('--nodata').trim() || '#e4e3de';
  p.ctx.fillRect(0, 0, p.w, p.h);

  if (layer) drawGrid(p, layer);

  // vector overlays share the projection and the same affine transform
  var path = d3.geoPath(p.proj);
  var t = state.transform;
  var tf = 'translate(' + t.x + ',' + t.y + ') scale(' + t.k + ')';
  var coastW = 0.9 / t.k, gratW = 0.5 / t.k;

  p.gGrat.attr('transform', tf).selectAll('path')
    .data(state.grat ? [d3.geoGraticule().step([10, 10])()] : [])
    .join('path')
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', css.getPropertyValue('--grat').trim())
    .attr('stroke-width', gratW);

  // Coast and state lines carry a contrasting halo so they stay readable over
  // both ends of the colour ramp — without that the alignment check is
  // impossible exactly where the data is densest.
  var halo = css.getPropertyValue('--surface-1').trim();
  var ink = css.getPropertyValue('--coast').trim();

  p.gLand.attr('transform', tf).selectAll('path')
    .data(state.coast && world.land ? [
      { g: world.land, s: halo, w: coastW * 3, o: 0.65 },
      { g: world.land, s: ink, w: coastW, o: 1 }
    ] : [])
    .join('path')
    .attr('d', function (x) { return path(x.g); })
    .attr('fill', 'none')
    .attr('stroke', function (x) { return x.s; })
    .attr('stroke-width', function (x) { return x.w; })
    .attr('opacity', function (x) { return x.o; })
    .attr('stroke-linejoin', 'round');

  var showStates = state.coast && world.states && p.w > 200 &&
                   bboxFor(focusDs || (layer && layer.ds))[2] < -50;
  p.gState.attr('transform', tf).selectAll('path')
    .data(showStates ? [
      { g: world.states, s: halo, w: 2.2 / t.k, o: 0.55 },
      { g: world.states, s: ink, w: 0.7 / t.k, o: 0.8 }
    ] : [])
    .join('path')
    .attr('d', function (x) { return path(x.g); })
    .attr('fill', 'none')
    .attr('stroke', function (x) { return x.s; })
    .attr('stroke-width', function (x) { return x.w; })
    .attr('opacity', function (x) { return x.o; })
    .attr('stroke-linejoin', 'round');

  // footprint outline of another dataset, for the alignment check
  var ov = state.overlay ? byKey(state.overlay) : null;
  p.gOver.attr('transform', tf).selectAll('path')
    .data(ov && ov.n_valid ? [footprint(ov)] : [])
    .join('path')
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', '#eb6834')
    .attr('stroke-width', 1.2 / t.k)
    .attr('stroke-linejoin', 'round');
}

/** MultiLineString tracing the boundary of a dataset's valid-cell mask. */
var footprintCache = {};
function footprint(d) {
  if (footprintCache[d.key]) return footprintCache[d.key];
  var segs = [];
  var hx = d.dlon / 2, hy = d.dlat / 2;
  var has = function (i, j) {
    if (i < 0 || i >= d.nlon || j < 0 || j >= d.nlat) return false;
    return !isNaN(d.grid[i + j * d.nlon]);
  };
  for (var j = 0; j < d.nlat; j++) {
    for (var i = 0; i < d.nlon; i++) {
      if (!has(i, j)) continue;
      var lon = d.lon0 + i * d.dlon, lat = d.lat0 + j * d.dlat;
      if (!has(i - 1, j)) segs.push([[lon - hx, lat - hy], [lon - hx, lat + hy]]);
      if (!has(i + 1, j)) segs.push([[lon + hx, lat - hy], [lon + hx, lat + hy]]);
      if (!has(i, j - 1)) segs.push([[lon - hx, lat - hy], [lon + hx, lat - hy]]);
      if (!has(i, j + 1)) segs.push([[lon - hx, lat + hy], [lon + hx, lat + hy]]);
    }
  }
  var geo = { type: 'MultiLineString', coordinates: segs };
  footprintCache[d.key] = geo;
  return geo;
}

// ---------------------------------------------------------------- hover

var tip = document.getElementById('tooltip');

function onHover(p, ev) {
  if (!p.proj || !p.layer) return hideTip();
  var r = p.canvas.getBoundingClientRect();
  var mx = ev.clientX - r.left, my = ev.clientY - r.top;
  var t = state.transform;
  var pt = p.proj.invert ? p.proj.invert([(mx - t.x) / t.k, (my - t.y) / t.k])
                         : null;
  if (!pt || !isFinite(pt[0]) || !isFinite(pt[1])) return hideTip();

  var lon = pt[0], lat = pt[1];
  var rows = [];
  rows.push(['lon, lat', lon.toFixed(2) + '°, ' + lat.toFixed(2) + '°']);

  var title;
  if (p.layer.kind === 'diff') {
    var st = p.layer.stats;
    var va = sampleDisplay(st.A, lon, lat), vb = sampleDisplay(st.B, lon, lat);
    title = p.layer.label;
    rows.push([st.A.short, fmt(va) + ' ' + unitLabel(st.A)]);
    rows.push([st.B.short, fmt(vb) + ' ' + unitLabel(st.B)]);
    var dv = va - vb;
    rows.push(['difference', (isNaN(dv) ? '—' : (dv > 0 ? '+' : '') + fmt(dv))]);
  } else {
    var d = p.layer.ds;
    title = d.study || d.short;
    rows.push(['yield', fmt(sampleDisplay(d, lon, lat)) + ' ' + unitLabel(d)]);
    var other = byKey(state.b);
    if (state.mode === 'side' && other && other !== d) {
      rows.push([other.short, fmt(sampleDisplay(other, lon, lat)) + ' ' +
                 unitLabel(other)]);
    }
  }

  tip.innerHTML = '<div class="tt-t"></div>' + rows.map(function (rw) {
    return '<div class="tt-r"><span></span><b></b></div>';
  }).join('');
  tip.querySelector('.tt-t').textContent = title;
  var bs = tip.querySelectorAll('.tt-r');
  rows.forEach(function (rw, k) {
    bs[k].children[0].textContent = rw[0];
    bs[k].children[1].textContent = rw[1];
  });

  tip.classList.remove('hidden');
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + tw > window.innerWidth - 8) x = ev.clientX - tw - 14;
  if (y + th > window.innerHeight - 8) y = ev.clientY - th - 14;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function hideTip() { tip.classList.add('hidden'); }

function fmt(v) {
  if (v === null || v === undefined || isNaN(v)) return 'no data';
  return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
}

// ---------------------------------------------------------------- legend

function drawLegend(layers) {
  var el = d3.select('#legend');
  el.selectAll('*').remove();

  layers.forEach(function (layer) {
    if (!layer) return;
    var g = el.append('div').attr('class', 'lg');
    g.append('span').attr('class', 'lbl').text(layer.label);

    var w = 190, h = 10;
    var svg = g.append('svg').attr('width', w).attr('height', h + 16);
    var id = 'grad-' + Math.random().toString(36).slice(2);
    var stops = d3.range(0, 1.0001, 1 / 24);
    svg.append('defs').append('linearGradient')
      .attr('id', id).attr('x1', '0%').attr('x2', '100%')
      .selectAll('stop').data(stops).join('stop')
      .attr('offset', function (t) { return (t * 100) + '%'; })
      .attr('stop-color', function (t) {
        return layer.color.diverging ? divRamp(t) : seqRamp(t);
      });

    svg.append('rect')
      .attr('width', w).attr('height', h).attr('rx', 2)
      .attr('fill', 'url(#' + id + ')')
      .attr('stroke', 'var(--border-strong)').attr('stroke-width', 0.5);

    var x = d3.scaleLinear().domain(layer.color.domain).range([0, w]);
    var axis = d3.axisBottom(x).ticks(5).tickSize(3);
    var ax = svg.append('g').attr('transform', 'translate(0,' + h + ')')
      .call(axis);
    ax.select('.domain').remove();
    ax.selectAll('text')
      .attr('font-size', 9).attr('fill', 'var(--text-secondary)').attr('dy', 6);
    ax.selectAll('line').attr('stroke', 'var(--border-strong)');

    g.append('span').attr('class', 'lbl').text(layer.units);
  });

  var nd = el.append('div').attr('class', 'lg');
  nd.append('span').attr('class', 'swatch')
    .style('background', 'var(--nodata)');
  nd.append('span').attr('class', 'lbl').text('no data / masked');
}

// ---------------------------------------------------------------- render

function renderAll() {
  var A = byKey(state.a), B = byKey(state.b);

  document.querySelectorAll('.mode').forEach(function (b) {
    b.classList.toggle('is-active', b.dataset.mode === state.mode);
  });
  ['single', 'side', 'diff', 'grid'].forEach(function (m) {
    document.getElementById('view-' + m).classList.toggle('hidden',
      state.mode !== m);
  });

  if (state.mode === 'single' && A) {
    var la = layerFor(A);
    setHead('A', A);
    drawPane(pane('wrap-A'), la, A);
    drawLegend([la]);
    alignStats(A, B && B !== A ? B : null);

  } else if (state.mode === 'side' && A && B) {
    var l1 = layerFor(A), l2 = layerFor(B);
    setHead('A2', A); setHead('B2', B);
    // both panes share one focus extent so the two maps are directly comparable
    var focus = state.extent === 'auto' ? unionDs(A, B) : null;
    drawPane(pane('wrap-A2'), l1, focus || A);
    drawPane(pane('wrap-B2'), l2, focus || B);
    drawLegend([l1, l2]);
    alignStats(A, B);

  } else if (state.mode === 'diff' && A && B) {
    var dl = diffLayer(A, B);
    document.getElementById('title-D').textContent = dl.label;
    document.getElementById('meta-D').textContent = diffMeta(dl);
    drawPane(pane('wrap-D'), dl, dl.ds);
    drawLegend([dl]);
    alignStats(A, B);

  } else if (state.mode === 'grid') {
    drawLegend([renderGrid()]);
    alignStats(A, B);
  }
}

/** Pseudo-dataset carrying the union bbox of two datasets, for fitting. */
function unionDs(A, B) {
  return {
    bbox: [Math.min(A.bbox[0], B.bbox[0]), Math.min(A.bbox[1], B.bbox[1]),
           Math.max(A.bbox[2], B.bbox[2]), Math.max(A.bbox[3], B.bbox[3])]
  };
}

/** The meta line, with each field carrying a label so it can be identified. */
var META_FIELDS = [
  ['model',        'Model'],
  ['extent_label', 'Extent'],
  ['period',       'Modelling period'],
  ['resolution',   'Grid resolution'],
  ['__cells',      'Grid count — cells holding a value']
];

function setHead(slot, d) {
  document.getElementById('title-' + slot).textContent = d.title || d.study;

  var el = document.getElementById('meta-' + slot);
  el.innerHTML = '';
  var first = true;
  META_FIELDS.forEach(function (f) {
    var val = f[0] === '__cells'
      ? d.n_valid.toLocaleString() + ' cells with data'
      : d[f[0]];
    if (!val) return;
    if (!first) el.appendChild(document.createTextNode(' · '));
    first = false;
    var s = document.createElement('span');
    s.className = 'part';
    s.textContent = val;
    s.title = f[1];
    el.appendChild(s);
  });
}

function diffMeta(dl) {
  var s = dl.stats;
  var mean = s.vals.length ? d3.mean(s.vals) : NaN;
  return 'On the ' + Math.abs(s.grid.dlon) + '° grid · ' +
    s.both.toLocaleString() + ' cells in common · mean difference ' +
    (isNaN(mean) ? '—' : (mean > 0 ? '+' : '') + mean.toFixed(2) +
     ' Mg ha⁻¹');
}

function renderGrid() {
  var host = document.getElementById('grid-maps');
  if (!host.dataset.built) {
    WITH_DATA.forEach(function (d) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      cell.innerHTML = '<h4></h4><p class="meta"></p>' +
                       '<div class="map-wrap" id="gw-' + d.key + '"></div>';
      cell.querySelector('h4').textContent = d.short;
      cell.querySelector('.meta').textContent =
        [d.model, d.period].filter(Boolean).join(' · ');
      cell.addEventListener('click', function () {
        state.a = d.key; state.mode = 'single';
        state.transform = d3.zoomIdentity;
        syncList(); renderAll();
      });
      host.appendChild(cell);
    });
    host.dataset.built = '1';
  }
  // Small multiples only earn their keep on a common scale, so the thumbnails
  // ignore the per-map colour domain and always use the shared one.
  var savedT = state.transform, savedD = state.domain;
  state.transform = d3.zoomIdentity;   // thumbnails always show the full map
  state.domain = 'shared';
  var legend = null;
  WITH_DATA.forEach(function (d) {
    var l = layerFor(d);
    if (!legend) { legend = l; legend.label = 'All maps (common scale)'; }
    drawPane(pane('gw-' + d.key, { interactive: false }), l, d);
  });
  state.transform = savedT;
  state.domain = savedD;
  return legend;
}

// ---------------------------------------------------------------- alignment

function alignStats(A, B) {
  var host = document.getElementById('align-stats');
  if (!A) { host.innerHTML = ''; return; }

  var rows = [];
  rows.push(['A grid', A.nlon + ' × ' + A.nlat + ' @ ' + A.dlon + '°']);
  rows.push(['A cell origin',
    'lon ' + A.lon0.toFixed(3) + ', lat ' + A.lat0.toFixed(3)]);

  if (B) {
    rows.push(['B grid', B.nlon + ' × ' + B.nlat + ' @ ' + B.dlon + '°']);

    // Do the two grids share CELL EDGES? Comparing centres would flag the
    // 0.125° half-cell offset that correct 0.25°-in-0.5° nesting produces.
    var fine = Math.min(Math.abs(A.dlon), Math.abs(B.dlon));
    var fineY = Math.min(Math.abs(A.dlat), Math.abs(B.dlat));
    var offx = edgeOffset(A.lon0 - A.dlon / 2, B.lon0 - B.dlon / 2, fine);
    var offy = edgeOffset(A.lat0 - A.dlat / 2, B.lat0 - B.dlat / 2, fineY);
    var nested = offx < 1e-6 && offy < 1e-6;
    rows.push(['grid registration',
      nested ? 'cell edges nest exactly'
             : 'edges off by ' + offx.toFixed(3) + '°, ' + offy.toFixed(3) + '°']);

    // mask agreement + value correlation on the coarser common grid
    var st = maskStats(A, B);
    var jac0 = st.both + st.onlyA + st.onlyB
      ? st.both / (st.both + st.onlyA + st.onlyB) : NaN;
    rows.push(['cells in both', st.both.toLocaleString()]);
    rows.push(['mask overlap (Jaccard)', isNaN(jac0) ? '—' : jac0.toFixed(3)]);
    rows.push(['Pearson r', isNaN(st.r) ? '—' : st.r.toFixed(2)]);
    rows.push(['best shift / overlap there',
      '(' + st.shift[0] + ', ' + st.shift[1] + ') → ' + st.bestJ.toFixed(3)]);
  }

  // The pairwise numbers above confound georeferencing with study scope, so
  // the decisive test is each map against the coastline on its own.
  [['A', A], ['B', B]].forEach(function (p) {
    if (!p[1]) return;
    var lt = landTest(p[1]);
    if (!lt) return;
    rows.push([p[0] + ' cells off land', lt.base.toFixed(1) + '%']);
    rows.push([p[0] + ' best vs coastline',
      '(' + lt.dx.toFixed(2) + '°, ' + lt.dy.toFixed(2) + '°) → ' +
      lt.best.toFixed(1) + '%']);
  });

  host.innerHTML = '<table></table>';
  var tb = host.querySelector('table');
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    var td1 = document.createElement('td'); td1.textContent = r[0];
    var td2 = document.createElement('td'); td2.textContent = r[1];
    tr.appendChild(td1); tr.appendChild(td2);
    tb.appendChild(tr);
  });
}

function mod(a, m) { return ((a % m) + m) % m; }

/** Distance between two grid-edge origins, modulo the finer cell size. */
function edgeOffset(e1, e2, fine) {
  var o = mod(e1 - e2, fine);
  return Math.min(o, fine - o);
}

// ---- land-mask registration test ------------------------------------------
//
// A dataset's own georeferencing can be checked without reference to any other
// study: land-based yields should not sit over water. The mask is rasterized
// once from the 110m coastline, with the sharper 10m US state polygons burned
// on top so the test is precise where most of these maps live.

var landMask = null;

function buildLandMask() {
  if (landMask || !world.land) return;
  var W = 3600, H = 1800;
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  var proj = d3.geoEquirectangular()
    .translate([W / 2, H / 2]).scale(W / (2 * Math.PI));
  cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
  cx.fillStyle = '#fff';
  var path = d3.geoPath(proj, cx);
  cx.beginPath(); path(world.land); cx.fill();
  if (world.statesFeat) { cx.beginPath(); path(world.statesFeat); cx.fill(); }
  var img = cx.getImageData(0, 0, W, H).data;
  var bits = new Uint8Array(W * H);
  for (var i = 0; i < W * H; i++) bits[i] = img[i * 4] > 128 ? 1 : 0;
  landMask = { W: W, H: H, bits: bits, proj: proj };
}

function isLand(lon, lat) {
  var p = landMask.proj([lon, lat]);
  if (!p) return false;
  var x = Math.round(p[0]), y = Math.round(p[1]);
  if (x < 0 || x >= landMask.W || y < 0 || y >= landMask.H) return false;
  return landMask.bits[y * landMask.W + x] === 1;
}

var landCache = {};
function landTest(d) {
  buildLandMask();
  if (!landMask || !d.n_valid) return null;
  if (landCache[d.key]) return landCache[d.key];

  var pts = [];
  var step = Math.max(1, Math.floor(d.idx.length / 6000));
  for (var k = 0; k < d.idx.length; k += step) {
    var i = d.idx[k] % d.nlon, j = (d.idx[k] - i) / d.nlon;
    pts.push([d.lon0 + i * d.dlon, d.lat0 + j * d.dlat]);
  }
  var frac = function (dx, dy) {
    var off = 0;
    for (var m = 0; m < pts.length; m++) {
      if (!isLand(pts[m][0] + dx, pts[m][1] + dy)) off++;
    }
    return 100 * off / pts.length;
  };
  var base = frac(0, 0);
  var best = { f: base, dx: 0, dy: 0 };
  for (var sx = -2; sx <= 2; sx += 0.5) {
    for (var sy = -2; sy <= 2; sy += 0.5) {
      var f = frac(sx * d.dlon, sy * d.dlat);
      if (f < best.f - 1e-9) best = { f: f, dx: sx * d.dlon, dy: sy * d.dlat };
    }
  }
  var out = { base: base, best: best.f, dx: best.dx, dy: best.dy };
  landCache[d.key] = out;
  return out;
}

/** Mask overlap and the whole-cell shift of B that best matches A's mask. */
var maskCache = {};
function maskStats(A, B) {
  var ck = A.key + '|' + B.key + '|' + (state.davis ? 1 : 0);
  if (maskCache[ck]) return maskCache[ck];

  var G = Math.abs(A.dlon) >= Math.abs(B.dlon) ? A : B;
  var lo0 = Math.max(A.bbox[0], B.bbox[0]), lo1 = Math.min(A.bbox[2], B.bbox[2]);
  var la0 = Math.max(A.bbox[1], B.bbox[1]), la1 = Math.min(A.bbox[3], B.bbox[3]);

  var lons = [], lats = [];
  for (var i = 0; i < G.nlon; i++) {
    var lo = G.lon0 + i * G.dlon;
    if (lo >= lo0 && lo <= lo1) lons.push(lo);
  }
  for (var j = 0; j < G.nlat; j++) {
    var la = G.lat0 + j * G.dlat;
    if (la >= la0 && la <= la1) lats.push(la);
  }

  var fa = unitFactor(A), fb = unitFactor(B);
  var both = 0, onlyA = 0, onlyB = 0, xs = [], ys = [];
  lats.forEach(function (la) {
    lons.forEach(function (lo) {
      var va = sample(A, lo, la), vb = sample(B, lo, la);
      var ha = !isNaN(va), hb = !isNaN(vb);
      if (ha && hb) { both++; xs.push(va * fa); ys.push(vb * fb); }
      else if (ha) onlyA++;
      else if (hb) onlyB++;
    });
  });

  var bestJ = both + onlyA + onlyB ? both / (both + onlyA + onlyB) : 0;
  var shift = [0, 0];
  for (var sx = -3; sx <= 3; sx++) {
    for (var sy = -3; sy <= 3; sy++) {
      if (!sx && !sy) continue;
      var b2 = 0, a2 = 0, c2 = 0;
      for (var jj = 0; jj < lats.length; jj++) {
        for (var ii = 0; ii < lons.length; ii++) {
          var ha2 = !isNaN(sample(A, lons[ii], lats[jj]));
          var hb2 = !isNaN(sample(B, lons[ii] + sx * G.dlon,
                                     lats[jj] + sy * G.dlat));
          if (ha2 && hb2) b2++; else if (ha2) a2++; else if (hb2) c2++;
        }
      }
      var jv = b2 + a2 + c2 ? b2 / (b2 + a2 + c2) : 0;
      if (jv > bestJ + 1e-9) { bestJ = jv; shift = [sx, sy]; }
    }
  }

  var out = { both: both, onlyA: onlyA, onlyB: onlyB, bestJ: bestJ,
              r: pearson(xs, ys), shift: shift };
  maskCache[ck] = out;
  return out;
}

function pearson(x, y) {
  var n = x.length;
  if (n < 3) return NaN;
  var mx = d3.mean(x), my = d3.mean(y), sxy = 0, sxx = 0, syy = 0;
  for (var i = 0; i < n; i++) {
    var a = x[i] - mx, b = y[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : NaN;
}

// ---------------------------------------------------------------- sidebar

function buildList() {
  var ul = document.getElementById('ds-list');
  DATA.forEach(function (d) {
    var li = document.createElement('li');
    var usable = d.n_valid > 0 && !d.dup_of;
    var btn = document.createElement('button');
    btn.className = 'ds' + (usable ? '' : ' empty');
    btn.dataset.key = d.key;
    btn.disabled = !usable;

    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = d.study || d.key;

    var dt = document.createElement('span');
    dt.className = 'dt';
    dt.textContent = [d.model, d.extent_label, d.resolution]
      .filter(Boolean).join(' · ');

    var tag = document.createElement('span');
    tag.className = 'tag';

    var c = CITES[d.key];
    if (c) btn.title = citationText(c);

    btn.appendChild(nm);
    btn.appendChild(dt);
    btn.appendChild(tag);

    if (!usable) {
      var f = document.createElement('span');
      f.className = 'flag';
      f.textContent = d.dup_of ? 'holds ' + d.dup_of + '’s data'
                               : 'file is all fill value';
      btn.appendChild(f);
    }

    btn.addEventListener('click', function (ev) {
      if (!usable) return;
      if (ev.shiftKey) state.b = d.key;
      else state.a = d.key;
      state.transform = d3.zoomIdentity;
      syncList();
      renderAll();
    });

    li.appendChild(btn);
    ul.appendChild(li);
  });

  var sel = document.getElementById('overlay');
  WITH_DATA.forEach(function (d) {
    var o = document.createElement('option');
    o.value = d.key;
    o.textContent = d.short;
    sel.appendChild(o);
  });

  document.getElementById('ds-count').textContent =
    WITH_DATA.length + ' of ' + DATA.length;

  syncList();
}

function syncList() {
  document.querySelectorAll('.ds').forEach(function (b) {
    var isA = b.dataset.key === state.a;
    var isB = b.dataset.key === state.b;
    b.classList.toggle('sel-a', isA);
    b.classList.toggle('sel-b', isB);
    b.querySelector('.tag').textContent = isA && isB ? 'A B' : isA ? 'A' : isB ? 'B' : '';
  });
}

function buildNotes() {
  var el = document.getElementById('notes');
  var html = '';
  SUSPECT.forEach(function (d) {
    html += '<div class="warn"><b>' + d.key + ' does not contain its own data</b>' +
      ' — every valid cell in <code>' + d.key + '/extracted_yield.nc</code> is ' +
      'identical to <code>' + d.dup_of + '</code> at the same coordinates, ' +
      'though the file carries ' + (d.study || d.key) + '’s title, grid and ' +
      'attributes. Re-running one section of <code>extract_data.R</code> with a ' +
      'stale workspace produces exactly this. It is excluded above. Replace the ' +
      'file and re-run <code>export_json.R</code> to bring it back.</div>';
  });
  if (EMPTY.length) {
    html += '<div class="warn"><b>' + EMPTY.length +
      ' file(s) contain no data</b> — every cell in ' +
      EMPTY.map(function (d) { return '<code>' + d.key + '/extracted_yield.nc</code>'; })
        .join(', ') +
      ' is the <code>-999</code> fill value, so they are disabled above. ' +
      'The extraction step for these figures produced no classified cells.</div>';
  }
  html += 'Values are digitized from published figures except ' +
    '<code>li_2020</code>, which is the authors’ own NetCDF. ' +
    'Classed figures are reported at class midpoints, so within-class ' +
    'variation is lost. Davis is stored in g C m⁻² yr⁻¹ and ' +
    'is converted at ' + DAVIS_TO_MGHA + ' Mg ha⁻¹ per unit when the ' +
    'conversion box is ticked — the maps otherwise differ in units and ' +
    'must not be differenced directly. Studies also mask different areas ' +
    '(maize-growing land, trial-supported climates, land above a yield ' +
    'threshold), so a low mask overlap is usually a difference in scope, ' +
    'not in georeferencing.';
  el.innerHTML = html;
}

// ---------------------------------------------------------------- citations
//
// Records live in citations.js, read off each paper's own front matter. A
// dataset may have no record (a new folder, say), which is shown plainly
// rather than guessed at.

var CITES = window.CITATIONS || {};

/** Author list in reference style: A, B, C & D — with et al. past eight. */
function authorList(a) {
  if (!a || !a.length) return '';
  if (a.length > 8) return a.slice(0, 8).join(', ') + ', et al.';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
}

/** Plain-text citation, the thing that lands on the clipboard. */
function citationText(c) {
  var s = authorList(c.authors) + ' (' + c.year + '). ' + c.title + '. ' +
          c.journal;
  if (c.volume) s += ', ' + c.volume;
  if (c.pages) s += ', ' + c.pages;
  s += '.';
  if (c.doi) s += ' https://doi.org/' + c.doi;
  return s;
}

function refNode(key, c) {
  var wrap = document.createElement('div');
  wrap.className = 'ref';

  // Label each entry the way the sidebar does, so the modal and the dataset
  // list name the same study the same way.
  var ds = byKey(key);
  var k = document.createElement('span');
  k.className = 'ref-key';
  k.textContent = (ds && ds.study) || key;
  wrap.appendChild(k);

  if (!c) {
    var miss = document.createElement('p');
    miss.className = 'ref-missing';
    miss.textContent = 'No citation record for this dataset yet — add one to ' +
                       'citations.js.';
    wrap.appendChild(miss);
    return wrap;
  }

  // Built as nodes rather than innerHTML so a title with < or & can't break out
  var p = document.createElement('p');
  p.className = 'ref-full';
  p.appendChild(document.createTextNode(
    authorList(c.authors) + ' (' + c.year + '). '));
  var t = document.createElement('span');
  t.className = 'ttl';
  t.textContent = c.title;
  p.appendChild(t);
  p.appendChild(document.createTextNode('. ' + c.journal +
    (c.volume ? ', ' + c.volume : '') + (c.pages ? ', ' + c.pages : '') + '.'));
  wrap.appendChild(p);

  var links = document.createElement('div');
  links.className = 'ref-links';

  if (c.doi) {
    var a = document.createElement('a');
    a.href = 'https://doi.org/' + c.doi;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = c.doi;
    links.appendChild(a);
  }

  if (c.open) {
    var oa = document.createElement('span');
    oa.className = 'oa';
    oa.textContent = 'OPEN ACCESS';
    links.appendChild(oa);
  }

  var btn = document.createElement('button');
  btn.className = 'copybtn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', function () {
    var txt = citationText(c);
    var done = function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(txt, done); });
    } else fallback(txt, done);
  });
  links.appendChild(btn);
  wrap.appendChild(links);

  if (c.note) {
    var n = document.createElement('p');
    n.className = 'ref-note';
    n.textContent = c.note;
    wrap.appendChild(n);
  }
  return wrap;
}

/** clipboard API is unavailable on file:// in some browsers */
function fallback(text, done) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { /* give up quietly */ }
  document.body.removeChild(ta);
}

function openRefs(title, keys) {
  document.getElementById('modal-title').textContent = title;
  var body = document.getElementById('modal-body');
  body.innerHTML = '';
  keys.forEach(function (k) { body.appendChild(refNode(k, CITES[k])); });
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-close').focus();
}

function closeRefs() {
  document.getElementById('modal').classList.add('hidden');
}

// ---------------------------------------------------------------- about
//
// The project citation is still a placeholder — it is marked as one on screen
// so it cannot quietly ship as if it were a real reference.

var ABOUT = {
  citation: '<Placeholder Citation for Miscanthus Yield Modeling>',
  authors: 'Bryan Petersen and Dr. Andy VanLoocke, Associate Professor',
  department: 'Department of Agronomy',
  institution: 'Iowa State University',
  email: 'andyvanl@iastate.edu',   // null here shows a placeholder chip instead
  contact: 'https://www.agron.iastate.edu/people/vanloocke-andy/',
  funder: 'Center for Advanced Bioenergy and Bioproducts Innovation (CABBI)',
  funderUrl: 'https://cabbi.bio'
};

/** An amber dashed chip, for anything still unresolved. */
function placeholderChip(text) {
  var s = document.createElement('span');
  s.className = 'placeholder';
  s.textContent = text;
  return s;
}

/** Span of years covered by the loaded maps, read from the data itself. */
function coverage() {
  var years = [], models = {};
  WITH_DATA.forEach(function (d) {
    if (d.model) models[d.model] = 1;
    var m = String(d.period || '').match(/\d{4}/g);
    if (m) m.forEach(function (y) { years.push(+y); });
  });
  return {
    maps: WITH_DATA.length,
    models: Object.keys(models).length,
    from: years.length ? Math.min.apply(null, years) : null,
    to: years.length ? Math.max.apply(null, years) : null
  };
}

function openAbout() {
  document.getElementById('modal-title').textContent = 'About this viewer';
  var body = document.getElementById('modal-body');
  body.innerHTML = '';

  var cov = coverage();
  var wrap = document.createElement('div');
  wrap.className = 'about';

  var link = function (href, text) {
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    return a;
  };
  var para = function (cls) {
    var p = document.createElement('p');
    if (cls) p.className = cls;
    wrap.appendChild(p);
    return p;
  };

  var lede = para('lede');
  lede.textContent =
    'Miscanthus × giganteus has been simulated by a succession of independent ' +
    'modelling groups, yet their yield maps have never been placed on a common ' +
    'footing. Published as figures rather than as data — at differing ' +
    'resolutions, projections, extents and units — they cannot be compared ' +
    'until they are reconstructed.';

  var p2 = para();
  p2.appendChild(document.createTextNode('This viewer accompanies '));
  p2.appendChild(placeholderChip(ABOUT.citation));
  p2.appendChild(document.createTextNode(
    '. It returns those maps to gridded form, places them on shared ' +
    'coordinates, and provides the means to register, difference and ' +
    'interrogate them against one another.'));

  var p3 = para();
  p3.textContent =
    cov.maps + ' maps are held here, from ' + cov.models + ' models' +
    (cov.from ? ', spanning simulation periods from ' + cov.from + ' to ' +
      cov.to : '') +
    ' and extents from a single state to the whole globe. All but one are ' +
    'digitized from figures in the source papers; Li et al. (2020) is ' +
    'reproduced from the authors’ published NetCDF. Each map carries its own ' +
    'record of provenance, digitization method and known artefacts.';

  var p4 = para('caveat');
  p4.textContent =
    'Digitized values are reconstructions, not the original model output. ' +
    'Where a figure used discrete colour classes, values are class midpoints ' +
    'and within-class variation is lost. Treat them accordingly.';

  var credit = document.createElement('div');
  credit.className = 'about-credit';

  var by = document.createElement('p');
  by.appendChild(document.createTextNode('Developed by ' + ABOUT.authors + ', '));
  by.appendChild(document.createTextNode(
    ABOUT.department + ', ' + ABOUT.institution + '.'));
  credit.appendChild(by);

  var ct = document.createElement('p');
  ct.className = 'about-contact';
  if (ABOUT.email) {
    ct.appendChild(link('mailto:' + ABOUT.email, ABOUT.email));
  } else {
    ct.appendChild(placeholderChip('<email address to be added>'));
  }
  ct.appendChild(document.createTextNode(' · '));
  ct.appendChild(link(ABOUT.contact,
    ABOUT.contact.replace(/^https?:\/\//, '').replace(/\/$/, '')));
  credit.appendChild(ct);

  var fund = document.createElement('p');
  fund.className = 'about-fund';
  fund.appendChild(document.createTextNode('Supported by the ' + ABOUT.funder + ' · '));
  fund.appendChild(link(ABOUT.funderUrl, 'cabbi.bio'));
  credit.appendChild(fund);

  wrap.appendChild(credit);
  body.appendChild(wrap);
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-close').focus();
}

// ---------------------------------------------------------------- controls

/** Push state into the controls, so markup order can never disagree with it. */
function syncControls() {
  [['proj', 'proj'], ['extent', 'extent'], ['ramp', 'ramp'],
   ['domain', 'domain'], ['overlay', 'overlay']].forEach(function (p) {
    var el = document.getElementById(p[0]);
    if (el) el.value = state[p[1]];
  });
  [['opt-coast', 'coast'], ['opt-grat', 'grat'], ['opt-cells', 'cells'],
   ['opt-davis', 'davis']].forEach(function (p) {
    var el = document.getElementById(p[0]);
    if (el) el.checked = state[p[1]];
  });
}

function bind() {
  document.querySelectorAll('.mode').forEach(function (b) {
    b.addEventListener('click', function () {
      state.mode = b.dataset.mode;
      state.transform = d3.zoomIdentity;
      renderAll();
    });
  });

  var binds = [
    ['proj', 'proj'], ['extent', 'extent'], ['ramp', 'ramp'],
    ['domain', 'domain'], ['overlay', 'overlay']
  ];
  binds.forEach(function (p) {
    document.getElementById(p[0]).addEventListener('change', function (e) {
      state[p[1]] = e.target.value;
      if (p[1] === 'proj' || p[1] === 'extent') state.transform = d3.zoomIdentity;
      renderAll();
    });
  });

  [['opt-coast', 'coast'], ['opt-grat', 'grat'], ['opt-cells', 'cells'],
   ['opt-davis', 'davis']].forEach(function (p) {
    document.getElementById(p[0]).addEventListener('change', function (e) {
      state[p[1]] = e.target.checked;
      renderAll();
    });
  });

  document.querySelectorAll('.citebtn').forEach(function (b) {
    b.addEventListener('click', function () {
      var which = b.dataset.cite;
      var keys = which === 'b' ? [state.b]
               : which === 'ab' ? [state.a, state.b]
               : [state.a];
      keys = keys.filter(Boolean);
      if (!keys.length) return;
      var d = byKey(keys[0]);
      openRefs(keys.length > 1 ? 'References'
                               : 'Cite ' + ((d && d.study) || keys[0]), keys);
    });
  });

  document.getElementById('all-refs').addEventListener('click', function () {
    openRefs('References', DATA.map(function (d) { return d.key; }));
  });

  document.getElementById('more-info').addEventListener('click', openAbout);

  document.getElementById('modal-close').addEventListener('click', closeRefs);
  document.getElementById('modal').addEventListener('click', function (ev) {
    if (ev.target.id === 'modal') closeRefs();   // click the backdrop to close
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeRefs();
  });

  document.getElementById('reset-zoom').addEventListener('click', function () {
    state.transform = d3.zoomIdentity;
    Object.keys(panes).forEach(function (k) {
      if (panes[k].interactive) {
        d3.select(panes[k].canvas).call(d3.zoom().transform, d3.zoomIdentity);
      }
    });
    renderAll();
  });

  var raf = null;
  window.addEventListener('resize', function () {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderAll);
  });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', renderAll);
  }
}

// ---------------------------------------------------------------- boot

function loadWorld() {
  return Promise.all([
    d3.json(LAND_URL).catch(function () { return null; }),
    d3.json(STATES_URL).catch(function () { return null; })
  ]).then(function (res) {
    if (res[0]) world.land = topojson.feature(res[0], res[0].objects.land);
    if (res[1]) {
      world.states = topojson.mesh(res[1], res[1].objects.states,
        function (a, b) { return a !== b; });
      world.statesFeat = topojson.feature(res[1], res[1].objects.states);
    }
    world.failed = !res[0];
    if (world.failed) {
      var n = document.getElementById('notes');
      n.insertAdjacentHTML('afterbegin',
        '<div class="warn">Coastlines could not be loaded (no network). ' +
        'The maps still render; the graticule is the only geographic ' +
        'reference.</div>');
    }
  });
}

function init() {
  if (!DATA.length) {
    document.getElementById('notes').textContent = 'No data loaded.';
    return;
  }
  buildList();
  buildNotes();
  bind();
  syncControls();
  renderAll();
  loadWorld().then(renderAll);
}

init();
