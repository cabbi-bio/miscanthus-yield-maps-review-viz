# Miscanthus yield map viewer

A vanilla JavaScript + D3 v7 viewer for the digitized miscanthus yield maps in
`../data/*/extracted_yield.nc`.

Ten maps load. `miguez_2012/extracted_yield.nc` has been removed pending
re-extraction, so that folder is skipped; `shepherd_2020` loads but its values
look contaminated — see [Data quality](#data-quality).

`index.html` is the current page. `index_v1.html` is a kept snapshot of the
version before citations were added; it shares `style.css`, `app.js` and
`yield_data.js`, so it tracks changes to those and is not a frozen copy.

## Running it

```bash
cd /Users/jesspb/DATA/csm_yield_predictions/viz && python3 -m http.server 8731
```

Then open <http://localhost:8731>. Opening `index.html` directly off the disk
also works in Chrome, but a local server is the reliable path.

D3, TopoJSON, and the coastline/state outlines load from jsDelivr, so the page
needs a network connection the first time. Without one the maps still render —
only the coastlines drop out, and the page says so.

## Regenerating the data

`yield_data.js` is produced from the NetCDF files by `export_json.R`, using
`ncdf4` and `jsonlite`:

```bash
Rscript /Users/jesspb/DATA/csm_yield_predictions/viz/export_json.R
```

Each dataset is stored sparsely — `idx[k] = i + j*nlon` with
`val[k]` the value at that cell — with the grid described by `lon0`, `dlon`,
`nlon` and the latitude equivalents. Study metadata comes from
`../data/yield_maps.xlsx`.

## What the views do

| View | Purpose |
|---|---|
| **Single** | One map, zoomable, with a hover readout of lon/lat and value. |
| **Side by side** | Two maps on one shared extent and one shared zoom. |
| **Difference** | A − B on the coarser of the two grids, diverging scale centred on zero. |
| **All maps** | Every loaded map as small multiples on a single common colour scale. |
| **Ensemble** | All maps aggregated onto one 1° grid: mean, median, sd, CV, range, and the count of contributing maps. |

**Cite** in the map header opens that study's full reference; **References** in
the top bar opens all of them, labelled the same way the sidebar labels them.
Each entry has a DOI link and a copy button, and hovering a dataset in the
sidebar shows its citation as a tooltip.

**More info** opens the About modal — what the viewer is, who made it, and its
funding.

The metadata line under each map title is field-labelled: hover any segment and
it names itself (Model, Extent, Modelling period, Grid resolution, Grid count).
Labelled fields carry a dotted underline.

### One unresolved field in the About text

`ABOUT.citation` in `app.js` is still
`<Placeholder Citation for Miscanthus Yield Modeling>`, rendered as a dashed
amber chip so it reads as unfinished on screen rather than shipping as if it
were a real reference. Replace that string when the paper has a citation, and
the chip becomes ordinary text.

Contact details are set: `andyvanl@iastate.edu` renders as a `mailto:` link
beside the faculty page. Setting `ABOUT.email` back to `null` restores the
placeholder chip. Office (3015 Agronomy, 716 Farm House Ln) and phone
(515) 294-8398 are on record but deliberately not shown — add them to the
credit block if the page is meant to carry them.

The three counts in the third paragraph — number of maps, number of distinct
models, and the span of simulation years — are computed from the loaded data at
render time, so they cannot go stale as datasets come and go.

Two details worth confirming before this goes anywhere public:

- **CABBI's full name** is rendered as *Center for **Advanced** Bioenergy and
  Bioproducts Innovation*, which is what its own logo artwork spells out. The
  brief for this section omitted "Advanced". No grant number is asserted; if an
  award has to be acknowledged, add it to `ABOUT.funder`.
- **Bryan Petersen** is spelled to match `extract_data.R` and the Wiley library
  watermarks in the PDFs.

Zoom is applied as an affine transform on the projected plane, so the raster
cells and the vector coastlines can never drift apart under pan or zoom.

## The ensemble layer

Implemented in `ensemble.js`, which is independent of the rendering code and can
be run on its own. Design rationale, coverage measurements and the caveats are
in `ENSEMBLE.md`.

**Statistics are taken across maps, not across cells.** Each map is first
collapsed to a single area-weighted value per 1° cell, then n, mean, median, sd,
CV and range are computed over those per-map values — one map, one vote. Pooling
raw cells instead would weight the result by resolution: a 0.25° map drops ~16
values into a 1° cell against a 0.5° map's ~4.

Two details that are easy to get wrong and are load-bearing here:

- Overlap is computed from **cell extents, not cell centres**. A Littleton cell
  (1.875° × 1.25°) has one centre but covers ~2.3 one-degree cells, so centre
  binning would drop it from most of the area it actually covers.
- Areas are **spherical** (∝ Δlon · |sin lat₂ − sin lat₁|). The grids reach 83°N,
  where a planar approximation is off eightfold.

Controls: layer (default **median** — see the Davis note below), minimum
contributing maps (default **2**), minimum cell coverage (default **25%**), and
a per-map include list. **Export CSV** writes one
row per cell — lon, lat, n, every statistic, and the member list.

Hovering a cell lists every contributing map with its value and what fraction of
the cell it covers.

### Why the minimum-n default is 2

48% of 1° cells have exactly one contributing map. There, sd and range are
undefined, and drawing range as zero would render an unopposed model as perfect
agreement — the opposite of the truth. Those layers mask n = 1 regardless of the
filter setting.

The default also keeps the 1° grid honest. Littleton is the only input coarser
than 1°, so at n ≥ 2 every displayed cell has a contributor at 0.5° or finer.

### Davis dominates the ensemble mean — read the median alongside it

Converted to Mg ha⁻¹, `davis_2012` has a **median of 50.0** against 2.3–29.9 for
every other map, and a maximum of 61.1. In an Illinois cell it contributes 56
against a 10-map median of 18, pulling the mean 4.5 Mg ha⁻¹ above the median.

This is not a conversion error. Figure 2a really is in g C m⁻² yr⁻¹, its legend
classes are `<100, 100–200, 200–300, 300–600, 600–1000, 1000–1500, 1500–2000,
2000–2500, >2500`, and the digitized midpoints match them exactly. Two real
reasons for the gap:

- **Davis reports a different quantity.** Figure 2a is modelled potential
  *aboveground production*, not harvested yield. The other maps report
  harvested or harvestable yield, taken after senescence at well below peak
  standing biomass.
- **Its top class is open-ended.** `>2500` is represented by 2750, and a large
  share of the corn belt falls in it, so the true values there are unbounded.

**The default layer is therefore median, not mean.** With n rarely above 4
outside the US, a single outlier moves the mean a long way, and the median is
the more robust summary of what the models agree on. The mean stays one click
away; the gap between the two is itself informative, since it localises where a
single map is doing the work. Use the include list to check sensitivity by
switching Davis off.

## Colour

Yield uses **BrBG** by default — brown for the dry, low-yielding end and
blue-green for the productive end, which reads the right way round for a crop
map and is colourblind-safe. Inverted Turbo, Viridis, and a single-hue blue are
also selectable.

Two things follow from BrBG being a *diverging* scheme used on a *sequential*
quantity:

- Its midpoint is near-white, so the map background is the warm `--nodata` grey
  rather than panel white. Without that, mid-yield cells would read as holes in
  the data.
- The colour midpoint lands wherever the domain midpoint happens to be, which
  under **Per-map (min–max)** is an artefact of that map's range rather than a
  meaningful yield. Switch the colour scale to **Shared (0–40)** if you want the
  brown/green crossover to mean the same yield on every map — which is usually
  what you want when comparing studies.

Differences use a blue–grey–red diverging ramp anchored on zero, with poles and
midpoint stepped separately for light and dark themes.

## Units

Ten of the eleven studies are in Mg ha⁻¹ yr⁻¹. Davis et al. (2012) is stored in
g C m⁻² yr⁻¹ and is converted at 0.0222 Mg ha⁻¹ per unit (45% C) when the
conversion box is ticked. **Untick it and Davis must not be differenced against
anything** — the difference view will happily subtract mismatched units.

## Logos

CABBI then Iowa State, at the left of the header, separated from the title by a
rule.

The header uses `logo-cabbi.png` and `logo-isu.png`, which are derived from the
originals you dropped in — `cabbi-logo-dark.png` and
`Iowa-State-University-Logo.png` are untouched. Two reasons for the derived
copies:

- The Iowa State file is 45% transparent padding (content is 3775 × 1218 inside
  a 3840 × 2160 canvas). Sizing the original by height would have rendered the
  wordmark 56% smaller than CABBI's. Cropped to content, the two marks have
  nearly the same aspect ratio (3.10 vs 2.86) and balance at a shared height.
- Both were 3840 px and 1674 px wide for a 30 px slot; they are now 600 px, ~58
  KB each.

To regenerate after replacing an original:

```bash
sips -c 1218 3775 --cropOffset 471 32 Iowa-State-University-Logo.png --out logo-isu.png && sips -Z 600 logo-isu.png --out logo-isu.png
```

Both marks are dark-ink artwork, so in dark mode they sit on a small white
plate rather than being colour-filtered — CABBI's charcoal wordmark would
otherwise vanish, and filtering would misrepresent both brands' colours.

## Citations

`citations.js` holds one record per study. Every field was read off the
article's own front matter:

```bash
pdftotext -f 1 -l 1 -layout <folder>/full_text.pdf -
```

Nothing is inferred from the folder name, which matters in two cases:

- **`daly_2017`** — the article carries a **2018** issue date (GCB Bioenergy 10,
  717–734). Cite it as 2018.
- **`song_2012`** — the folder is named for the 2001–2012 simulation period, but
  the paper appeared in **2015** (BioEnergy Research 8, 688–715; online November
  2014). Cite it as 2015.

Both are flagged in the modal so the discrepancy is visible at the point of use.

Issue numbers are deliberately omitted — volume, pages and DOI are all printed
on the page; issue numbers mostly were not, and guessing them would put
unverified detail into a reference list.

Grepping DOIs out of the raw PDF bytes was tried first and does not work: the
most frequent DOI in a paper is usually one it cites, not its own. It returned
Miguez's DOI for `song_2012` and VanLoocke's for `zhuang_2013`, and found
nothing at all for the three Copernicus journals. The front-matter route is the
reliable one.

`citations.js` still carries a record for `miguez_2012`; it simply isn't shown
while that folder has no NetCDF.

## Data quality

### shepherd_2020 — values look contaminated

The file now has 14,415 cells, but several independent signs say the digitization
picked up the figure's line overlays rather than only its filled cells:

| Check | shepherd_2020 | for comparison |
|---|---|---|
| Cells off land | **18.3%** | li 2.2%, ai 7.4% |
| Best shift vs coastline | (0°, 1.00°) → still 14.8% | others reach ~0% |
| Flatness of the value distribution (CV across 8 bins) | **0.23** — nearly uniform | ai 0.76, littleton 1.05, li 1.65 |
| Southernmost data | −58.25°S, ~41 cells in the Southern Ocean | land ends near −55.9°S |

A real yield field is strongly skewed — most land low, a little land high. A
near-uniform spread across the entire colourbar is what you get when
anti-aliased strokes sweep the whole ramp. On screen the high-value teal cells
trace coastlines instead of filling continental interiors, and there is a row of
cells along the bottom frame of the figure.

The file's own `comment` attribute anticipates this: Fig. 13c has a continuous
non-linear colourbar plus river, city and graticule overlays. Those overlays
appear to be surviving the colour match. Worth a mask that drops pixels lying on
overlay strokes, and dropping everything below about −56°S.

## The alignment check

The sidebar panel reports two independent things.

**Cells off land** is the decisive one. It rasterizes the 110m world coastline
with the sharper 10m US state polygons burned on top, then reports the fraction
of a map's valid cells whose centres fall on water, and the sub-cell shift that
minimizes it. It needs no second study, so it separates georeferencing error
from differences in study scope. Judge the *shift*, not the raw percentage —
coarse grids legitimately place coastal cell centres offshore.

**Mask overlap / best shift** compares two studies. It is confounded by the
different areas each study chose to simulate (maize-growing land only,
climates with trial support, land above a yield threshold), so a low overlap is
usually a difference in scope rather than in registration. Read it second.

### Result as of this build

| Dataset | Off land | Best shift | Read |
|---|---|---|---|
| `daly_2017` | 0.0% | (0.00°, 0.13°) | registered |
| `davis_2012` | 0.0% | (0.00°, 0.00°) | registered |
| `vanloocke_2010` | 0.0% | (0.00°, 0.00°) | registered |
| `vanloocke_2012` | 0.0% | (0.00°, 0.00°) | registered |
| `zhuang_2013` | 0.0% | (0.00°, 0.00°) | registered |
| `li_2020` | 2.2% | (0.00°, 0.25°) | registered; published NetCDF, so this is the test's own baseline bias |
| `littleton_2020` | 20.6% | (0.00°, 0.00°) | registered; the 1.875° × 1.25° N96 cells are simply much larger than the coastline detail |
| `ai_2020` | 7.4% | (0.50°, 1.00°) | flat optimum, 0.8 pp gain — coastal bleed from a figure digitized at ~1.5 px per cell, not a discrete offset |
| `song_2012` | 2.6% | (−0.50°, 0.75°) | **worth a look** — the only registered map whose off-land fraction falls to zero under a shift |
| `shepherd_2020` | 18.3% | (0.00°, 1.00°) → 14.8% | **not a registration problem** — the values themselves are contaminated, see [Data quality](#data-quality) |

All grids are mutually consistent: the 0.25° grids nest exactly inside the 0.5°
grids (cell edges coincide; the 0.125° offset between cell *centres* is what
correct nesting looks like, not an error).

So the maps do line up. Eight of the ten optimize at or within a quarter-degree
of zero shift. `song_2012` is the one exception worth checking against Fig. 3a of
the source paper: two independent tests put its optimum roughly half a cell west
and one cell north, while every other CONUS map optimizes at exactly (0°, 0°).
`shepherd_2020` fails this test too, but for a different reason — it is not
misplaced, it has spurious cells, and no shift can fix that.

## Files that are excluded

`miguez_2012/extracted_yield.nc` has been deleted pending re-extraction. The
export skips folders with no NetCDF, so Miguez is simply absent rather than
shown as empty; it returns once the file is rebuilt and `export_json.R` is
re-run.

Any file that is present but all `-999` is loaded, flagged, and disabled in the
sidebar with the reason on its chip.

### The duplicate-content check

`daly_2017/extracted_yield.nc` was briefly in a third state: structurally
valid and correctly georeferenced, carrying Daly's title, grid, units and
comment — but holding `zhuang_2013`'s values in every one of its 2269 valid
cells, down to Zhuang's 1.5 Mg DM class midpoints. Re-running one section of
`extract_data.R` with a stale `miscanthus_cells` in the workspace produces
exactly that signature, and nothing downstream would have caught it: the file
plots without complaint.

That file has since been corrected (11,886 cells, Daly's own uneven class
midpoints 0, 0.5, 2, 4.5, 8, 12, 16, 20, 24 with the open `>22` class at 24),
and it registers cleanly.

The check that caught it stays in `export_json.R`: it compares every pair of
datasets cell by cell, and if two hold identical content it flags the more
recently written file with `dup_of`, prints a warning, and the viewer disables
it. Worth keeping whenever sections of the extraction script get re-run
individually.

## Reading the values

Every map except `li_2020` is digitized from a published figure. Classed
figures are reported at class midpoints, so within-class variation is gone and
the value distributions are discrete — visible as banding at high zoom. The
per-file `comment` attribute in each NetCDF records exactly how that map was
digitized and what its known artefacts are; it is worth reading before drawing
conclusions from any one map.
