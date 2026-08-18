# Proposed feature: ensemble statistics layer

Aggregate every loaded map onto one coarse grid and report, per cell, the
**mean, median, standard deviation and range** of predicted yield across the
maps that cover it — together with **how many maps contribute, and which**.

Status: **built.** Implemented in
`../miscanthus-yield-maps-viz-demo/ensemble.js` with the Ensemble mode in
`app.js`. This document is the rationale; the README carries the usage notes.

---

## 1. The central design decision: statistics across *maps*, not across *cells*

This is the one choice that determines whether the numbers mean anything.

A naive aggregation pools every fine cell falling inside a coarse cell and takes
statistics over that pool. That silently weights by resolution: inside one
1.875° × 1.25° cell, a 0.25° map contributes ~38 values and a 0.5° map ~9, so
the "mean across models" becomes a mean dominated by whichever model happened to
publish at finer resolution. The standard deviation is then mostly a measure of
within-map spatial texture, not between-map disagreement.

The proposal is a **two-stage aggregation**:

**Stage 1 — collapse each map to one value per coarse cell.**
For map *m* and coarse cell *C*, `v(m,C)` = area-weighted mean of *m*'s valid
cells overlapping *C*. One map, one vote.

**Stage 2 — take statistics across maps.**
Over the set `{v(m,C)}` for all contributing *m*, compute n, mean, median, sd,
range.

The resulting sd answers "how much do these models disagree here?", which is the
question worth asking.

---

## 2. Which grid

"The largest grid cell of any map" is Littleton's N96 grid, **1.875° × 1.25°**.
Worth knowing before committing to it: it nests with nothing. 1.25 / 0.5 = 2.5
and 1.875 / 0.25 = 7.5, so every other map's cells straddle its boundaries and
Stage 1 needs genuine area weighting rather than a simple bin-and-average.

Candidates, measured with true spherical area overlap and a 0.25 minimum
coverage fraction:

| Grid | Cells with data | n≥2 | n≥3 | n≥4 | CONUS cells | CONUS n≥5 |
|---|---|---|---|---|---|---|
| 1.875° × 1.25° (Littleton N96) | 7,999 | 53% | 27% | 12% | 469 | 38% |
| **1° × 1°** | 19,468 | 52% | 26% | 12% | **1,125** | 36% |
| 0.5° × 0.5° | 75,181 | 48% | 22% | 9% | 4,460 | 34% |

> **Correction.** An earlier version of this table reported N96 as materially
> better on overlap (n≥4 at 14% against 8% for 1°). That was an artefact of
> binning each map's cell *centres* into target cells, which penalises coarse
> inputs: a Littleton cell has one centre but covers ~2.3 one-degree cells, so
> Littleton appeared to contribute to less than half the cells it actually
> covers. Under correct area overlap the grids are indistinguishable on
> overlap, and the decision rests on resolution instead.

**Recommendation: 1° × 1°.**

The overlap structure is the same either way, so the question becomes where the
detail should go. The conterminous US is the only region where n exceeds 4 —
only four maps are global — and it is therefore the only region where the
ensemble has much to say. N96 resolves it into 469 cells, putting Illinois in
roughly two of them; 1° gives 1,125 at essentially unchanged overlap richness.
0.5° is worse on every axis and is not worth the extra cells.

**The cost, stated plainly:** Littleton is the only input coarser than 1°, and
it is the sole contributor in 41% of 1° cells against 37% at N96 — 8,011 cells
versus 2,998 that are really 1.875° × 1.25° blocks drawn at 1°.

**That cost is contained by the minimum-n filter.** A Littleton-only cell has
n = 1 by definition, and every other map is 0.5° or finer, so **at n ≥ 2 every
displayed cell has at least one contributor at 0.5° or better** and the 1°
presentation is defensible. This is why §4 sets the default minimum-n to 2
rather than 1. The n = 1 cells stay reachable by dropping the filter, with the
caveat visible.

### On pre-resampling Littleton

Not needed, and it buys less than it appears to. Stage 1's area-weighted
overlap already performs exactly that operation as part of the aggregation;
pre-resampling is the same arithmetic done earlier and less visibly.

It does not tidy the nesting either — 1.25 / 1 = 1.25 and 1.875 / 1 = 1.875, so
Littleton does not nest into a 1° grid. A resampling rule is still required, so
the area-weighting code does not disappear, it only moves upstream.

If Littleton is ever resampled for some other purpose, use **nearest neighbour,
not area-weighted or bilinear**. Its values are class midpoints from a digitized
classed figure (2, 6, 10 … 33.5); interpolation manufactures values
corresponding to no class in the original.

---

## 3. What counts as a contributing map

Three rules, each of which needs a decision.

**Units.** Davis is g C m⁻² yr⁻¹. The ensemble must either apply the ×0.0222
conversion or exclude Davis outright — averaging it raw would be meaningless.
Proposal: the layer requires the conversion, and the Davis toggle is disabled
(shown as forced-on) while the ensemble mode is active.

**Partial coverage.** A coarse cell can be fractionally covered — VanLoocke 2010
is Illinois only, and Zhuang and Davis are restricted to maize-growing land, so
many coarse cells are 5–20% covered by those maps. Counting a map that covers 4%
of a cell equally with one that covers 100% overstates n and distorts the mean.
Proposal: a **minimum coverage fraction**, default 0.25, exposed as a control.
`v(m,C)` is computed only where *m* covers at least that fraction of *C*.

**Per-map inclusion.** A checkbox list, all on by default. This is not a
nicety — `shepherd_2020` is currently contaminated (see README § Data quality)
and would poison every global cell it touches. The ensemble must be able to
exclude a map without deleting its file.

---

## 4. The statistics, and where they stop being meaningful

Per coarse cell, over the n contributing maps:

| Statistic | Defined for | Notes |
|---|---|---|
| `n` | always | count of contributing maps |
| `members` | always | the list of which maps |
| `mean` | n ≥ 1 | |
| `median` | n ≥ 1 | mean of the two middles when n is even |
| `min`, `max`, `range` | n ≥ 1 | range is identically 0 at n = 1 |
| `sd` | **n ≥ 2** | sample sd, n−1 denominator; undefined at n = 1 |
| `cv` = sd / mean | n ≥ 2, mean > 0 | unitless disagreement, comparable between regions |

**48% of 1° cells have n = 1.** For those, sd is undefined and range is a
misleading zero — a cell where one model is unopposed would otherwise render as
"perfect agreement", the exact opposite of the truth. Most of those cells are
Littleton alone (§2). Two mitigations, both proposed:

- The sd, CV and range layers **mask n = 1 cells** rather than drawing them as
  zero, using the existing no-data colour.
- A **minimum-n filter** (1 / 2 / 3 / 4+) applied to every layer at once,
  **defaulting to 2**. This is not only a statistical guard: at n ≥ 2 every cell
  has a contributor at 0.5° or finer, which is what makes the 1° grid honest.

---

## 5. Interface

A fifth mode button, **Ensemble**, beside All maps.

**Layer selector** — median · mean · sd · CV · range · n, **defaulting to
median**. With n rarely above 4 outside the US a single outlier moves the mean
a long way, and `davis_2012` is exactly that outlier wherever it contributes:
it reports aboveground production rather than harvested yield, on an open-topped
class scheme, so its converted median is 50 Mg ha⁻¹ against 2.3–29.9 for every
other map. In one Iowa cell it lifts the mean from 15.2 to 19.6 and the sd from
5.5 to 13.3.
`n` uses a discrete integer ramp; mean and median use the existing BrBG yield
ramp on the shared domain so they are directly comparable to the single maps;
sd, CV and range use a single-hue sequential ramp, since they are magnitudes of
disagreement rather than yields.

**Controls**, in the sidebar where the alignment panel sits:
- per-map inclusion checkboxes, with live n
- minimum coverage fraction (default 0.25)
- minimum n filter (default 2; see §2 and §4)

**Hover** answers the "which layers" question directly:

```
44.4°N, 89.1°W          6 of 10 maps
mean    22.4 Mg ha⁻¹    median  23.0
sd       4.1            range   11.5  (16.2 – 27.7)
─────────────────────────────────────
Daly 2017        24.0    (100% cover)
Davis 2012       21.6     (68%)
Miguez 2012      22.5    (100%)
Song 2012        16.2     (95%)
VanLoocke 2012   27.7    (100%)
Zhuang 2013       5.2     (31%)
```

**Export.** A button writing the ensemble grid to CSV — one row per coarse cell,
columns for lon, lat, n, each statistic, and a semicolon-joined member list.
Useful well beyond the viewer.

---

## 6. Caveats the interface has to carry

These are not footnotes; they change how the numbers should be read, and the
panel should state them.

**The ensemble mean is not a like-for-like average.** Where n = 6 in Iowa the
mean is over six models that each simulated that location. Where n = 2 in
central Asia it is over two global models. Where n = 2 in western Kansas it may
be over Zhuang and Davis, both of which report *only maize-growing land* — a
different quantity from a potential-yield map. Cells are comparable in method,
not in meaning.

**n is bounded by geography, not by agreement.** Only four maps are global, so
**outside the conterminous US n can never exceed 4**. This is visible as a sharp
cliff in the data: on the 1° grid, 1,863 cells at n = 4, then just 75 at n = 5.
Every n ≥ 5 cell is American. Users will otherwise read low n outside the US as
sparse agreement rather than sparse sampling.

**Simulation periods differ**, from 1961–1990 (Shepherd) to 2011–2020 (Davis).
The ensemble mixes climatologies four decades apart; some of the between-map sd
is real climate difference, not model disagreement.

**Digitization error is inside the sd.** Class-midpoint values carry roughly half
a class width of quantization — for Miguez that is ±2.5 Mg ha⁻¹ before any model
difference. The sd is a floor on disagreement, not a clean measure of it.

---

## 7. Implementation notes

Compute in the browser, not in R. The include-set and coverage threshold are
interactive, so the grid has to be rebuildable on demand; precomputing in
`export_json.R` would freeze both.

Cost is trivial: one pass over ~85,000 valid cells across all maps to accumulate
per-(cell, map) area-weighted sums, then one pass over ~19,000 target cells
computing statistics over ≤10 values each. Measured at well under 100 ms in
Node on this data. Memoize on the include-set plus coverage threshold.

Stage 1 must intersect **cell extents**, not bin cell centres. Centre-binning is
what produced the incorrect table in §2, and it does not merely mis-measure
coverage — it would drop Littleton from more than half the cells it actually
covers, silently lowering n across the whole map.

Area weighting must use true spherical cell area
(∝ Δlon · |sin lat₂ − sin lat₁|), not planar area, or high-latitude cells will be
over-weighted — Littleton's grid reaches 83°N, where a planar approximation is
off by a factor of eight.

Rendering reuses the existing `drawGrid` path unchanged; the ensemble is just
another pseudo-dataset with a grid, exactly as the difference layer already is.

---

## 8. Decisions — settled

1. **Grid: 1° × 1°**, minimum-n defaulting to 2. See §2.
2. **Minimum coverage fraction: 0.25**, exposed as a control.
3. **`shepherd_2020` is included by default**, as an ordinary map with no
   special annotation. Every map can be switched off individually if a
   sensitivity check is wanted.
4. **CSV export ships in the first cut.**
