/* Ensemble statistics across the yield maps.
 *
 * Two-stage aggregation, which is the whole point of this file:
 *
 *   Stage 1  each map is collapsed to ONE value per target cell, as the
 *            area-weighted mean of its cells overlapping that target cell.
 *   Stage 2  statistics are taken across MAPS, not across cells.
 *
 * Pooling every fine cell instead would weight the result by resolution: a
 * 0.25° map drops ~16 values into a 1° cell against a 0.5° map's ~4, so the
 * "mean across models" would be dominated by whoever published finest, and the
 * standard deviation would mostly measure within-map spatial texture rather
 * than between-model disagreement.
 *
 * Overlap is computed from cell EXTENTS, never from cell centres. Centre
 * binning silently drops a coarse map from most of the cells it covers — a
 * 1.875° x 1.25° cell has one centre but covers about 2.3 one-degree cells.
 *
 * Areas are spherical: a cell's area is proportional to
 * dlon * (sin(lat_top) - sin(lat_bottom)). Planar area would over-weight high
 * latitudes badly — the N96 grid reaches 83°N, where the error is eightfold.
 */
'use strict';

var Ensemble = (function () {

  var DEG = Math.PI / 180;
  function sin(d) { return Math.sin(d * DEG); }

  /** Area of a lon/lat box, in units proportional to true spherical area. */
  function boxArea(lo1, lo2, la1, la2) {
    return (lo2 - lo1) * (sin(la2) - sin(la1));
  }

  /**
   * datasets: [{ key, lon0, dlon, nlon, lat0, dlat, nlat, idx, val, factor }]
   *   idx/val are the sparse pairs; factor scales val into the shared unit.
   * opts: { dlon, dlat, minCoverage }
   *
   * Returns { dlon, dlat, nlon, nlat, cells } where cells is a Map from flat
   * target index to { members: [key], values: [Number], cover: [0..1] }.
   */
  function accumulate(datasets, opts) {
    var Dlon = opts.dlon, Dlat = opts.dlat;
    var nlon = Math.round(360 / Dlon), nlat = Math.round(180 / Dlat);
    var raw = new Map();          // targetIdx -> Map(key -> {ws, w})

    datasets.forEach(function (d) {
      var f = d.factor === undefined ? 1 : d.factor;
      var hx = Math.abs(d.dlon) / 2, hy = Math.abs(d.dlat) / 2;

      for (var k = 0; k < d.idx.length; k++) {
        var i = d.idx[k] % d.nlon, j = (d.idx[k] - i) / d.nlon;
        var lon = d.lon0 + i * d.dlon, lat = d.lat0 + j * d.dlat;
        var lo1 = lon - hx, lo2 = lon + hx;
        var la1 = Math.max(-90, lat - hy), la2 = Math.min(90, lat + hy);

        var r0 = Math.floor((la1 + 90) / Dlat), r1 = Math.ceil((la2 + 90) / Dlat);
        var c0 = Math.floor((lo1 + 180) / Dlon), c1 = Math.ceil((lo2 + 180) / Dlon);

        for (var cj = r0; cj < r1; cj++) {
          if (cj < 0 || cj >= nlat) continue;
          var tA = -90 + cj * Dlat, tB = tA + Dlat;
          var oa = Math.max(la1, tA), ob = Math.min(la2, tB);
          if (ob <= oa) continue;

          for (var ci = c0; ci < c1; ci++) {
            if (ci < 0 || ci >= nlon) continue;
            var xA = -180 + ci * Dlon, xB = xA + Dlon;
            var ox = Math.max(lo1, xA), oy = Math.min(lo2, xB);
            if (oy <= ox) continue;

            var a = boxArea(ox, oy, oa, ob);
            if (!(a > 0)) continue;
            var key = ci + cj * nlon;
            var m = raw.get(key);
            if (!m) { m = new Map(); raw.set(key, m); }
            var e = m.get(d.key);
            if (!e) { e = { ws: 0, w: 0 }; m.set(d.key, e); }
            e.ws += d.val[k] * f * a;
            e.w += a;
          }
        }
      }
    });

    // resolve to per-map values, applying the coverage threshold
    var minCov = opts.minCoverage || 0;
    var cells = new Map();
    raw.forEach(function (m, key) {
      var cj = Math.floor(key / nlon), ci = key % nlon;
      var tA = -90 + cj * Dlat;
      var cellArea = boxArea(-180 + ci * Dlon, -180 + (ci + 1) * Dlon,
                             tA, tA + Dlat);
      var members = [], values = [], cover = [];
      m.forEach(function (e, mk) {
        var cv = cellArea > 0 ? e.w / cellArea : 0;
        if (cv + 1e-9 < minCov) return;
        members.push(mk);
        values.push(e.ws / e.w);
        cover.push(Math.min(1, cv));
      });
      if (members.length) cells.set(key, { members: members, values: values,
                                           cover: cover });
    });

    return { dlon: Dlon, dlat: Dlat, nlon: nlon, nlat: nlat, cells: cells };
  }

  /** Statistics over one cell's per-map values. sd/cv are null below n = 2. */
  function stats(values) {
    var n = values.length;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var sum = 0;
    for (var i = 0; i < n; i++) sum += values[i];
    var mean = sum / n;
    var median = n % 2 ? sorted[(n - 1) / 2]
                       : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    var sd = null;
    if (n >= 2) {
      var ss = 0;
      for (var j = 0; j < n; j++) ss += (values[j] - mean) * (values[j] - mean);
      sd = Math.sqrt(ss / (n - 1));      // sample sd
    }
    return {
      n: n, mean: mean, median: median, sd: sd,
      cv: (sd !== null && mean > 0) ? sd / mean : null,
      min: sorted[0], max: sorted[n - 1], range: n >= 2 ? sorted[n - 1] - sorted[0] : null
    };
  }

  /** Which statistics exist at n = 1, and which must be masked there. */
  var LAYERS = {
    n:      { label: 'Contributing maps',   unit: 'maps',     minN: 1, kind: 'count' },
    mean:   { label: 'Mean yield',          unit: 'Mg ha⁻¹',  minN: 1, kind: 'yield' },
    median: { label: 'Median yield',        unit: 'Mg ha⁻¹',  minN: 1, kind: 'yield' },
    sd:     { label: 'Standard deviation',  unit: 'Mg ha⁻¹',  minN: 2, kind: 'spread' },
    cv:     { label: 'Coefficient of variation', unit: '',    minN: 2, kind: 'spread' },
    range:  { label: 'Range (max − min)',   unit: 'Mg ha⁻¹',  minN: 2, kind: 'spread' }
  };

  /**
   * Build a dense grid of one statistic, as a Float64Array of NaN/value,
   * honouring both the layer's own floor and the user's minimum-n filter.
   */
  function layerGrid(ens, which, minN) {
    var spec = LAYERS[which];
    var floor = Math.max(spec.minN, minN || 1);
    var g = new Float64Array(ens.nlon * ens.nlat);
    g.fill(NaN);
    ens.cells.forEach(function (c, key) {
      if (c.members.length < floor) return;
      var s = c.stats || (c.stats = stats(c.values));
      var v = s[which];
      if (v === null || v === undefined || isNaN(v)) return;
      g[key] = v;
    });
    return g;
  }

  /** Statistics for one cell, or null. Used by the hover readout. */
  function at(ens, lon, lat) {
    var ci = Math.floor((lon + 180) / ens.dlon);
    var cj = Math.floor((lat + 90) / ens.dlat);
    if (ci < 0 || ci >= ens.nlon || cj < 0 || cj >= ens.nlat) return null;
    var c = ens.cells.get(ci + cj * ens.nlon);
    if (!c) return null;
    if (!c.stats) c.stats = stats(c.values);
    return { cell: c, stats: c.stats,
             lon: -180 + (ci + 0.5) * ens.dlon,
             lat: -90 + (cj + 0.5) * ens.dlat };
  }

  /** One row per cell holding data. `label` maps a dataset key to a name. */
  function toCSV(ens, minN, label) {
    var head = ['lon', 'lat', 'n', 'mean', 'median', 'sd', 'cv', 'range',
                'min', 'max', 'members'];
    var rows = [head.join(',')];
    var num = function (v) {
      return (v === null || v === undefined || isNaN(v)) ? '' : (+v).toFixed(4);
    };
    var keys = Array.from(ens.cells.keys()).sort(function (a, b) { return a - b; });
    keys.forEach(function (key) {
      var c = ens.cells.get(key);
      if (c.members.length < (minN || 1)) return;
      if (!c.stats) c.stats = stats(c.values);
      var s = c.stats;
      var ci = key % ens.nlon, cj = Math.floor(key / ens.nlon);
      var names = c.members.map(label || function (k) { return k; }).join('; ');
      rows.push([
        (-180 + (ci + 0.5) * ens.dlon).toFixed(4),
        (-90 + (cj + 0.5) * ens.dlat).toFixed(4),
        s.n, num(s.mean), num(s.median), num(s.sd), num(s.cv),
        num(s.range), num(s.min), num(s.max),
        '"' + names.replace(/"/g, '""') + '"'
      ].join(','));
    });
    return rows.join('\n') + '\n';
  }

  return { accumulate: accumulate, stats: stats, layerGrid: layerGrid,
           at: at, toCSV: toCSV, LAYERS: LAYERS };
})();
