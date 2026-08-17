suppressMessages({library(ncdf4); library(jsonlite); library(readxl)})
setwd("/Users/jesspb/DATA/csm_yield_predictions/data")

meta <- as.data.frame(read_excel("yield_maps.xlsx"))
# map folder -> xlsx row
key_of <- function(s) {
  s <- tolower(s)
  a <- sub("^([a-z]+).*", "\\1", s)
  y <- regmatches(s, regexpr("[0-9]{4}", s))
  paste0(a, "_", y)
}
meta$key <- key_of(meta$study)

dirs <- sort(basename(list.dirs(".", recursive=FALSE)))
dirs <- dirs[file.exists(file.path(dirs, "extracted_yield.nc"))]

out <- lapply(dirs, function(d) {
  nc <- nc_open(file.path(d,"extracted_yield.nc"))
  lon <- as.numeric(ncvar_get(nc,"lon")); lat <- as.numeric(ncvar_get(nc,"lat"))
  y   <- ncvar_get(nc,"yield")
  ga  <- ncatt_get(nc, 0)
  va  <- ncatt_get(nc, "yield")
  nc_close(nc)

  m  <- meta[match(d, meta$key), ]
  ok <- which(!is.na(y))                       # column-major: i = lon, j = lat
  v  <- round(as.numeric(y[ok]), 3)

  list(
    key   = d,
    study = if (nrow(m)) m$study else d,
    model = if (nrow(m)) m$model else NA,
    extent_label = if (nrow(m)) m$extent else NA,
    period       = if (nrow(m)) m$time_period else NA,
    resolution   = if (nrow(m)) m$spatial_resolution else NA,
    source_format= if (nrow(m)) m$format else NA,
    projection   = if (nrow(m)) m$projection else NA,
    units     = va$units,
    long_name = va$long_name,
    comment   = va$comment,
    title     = ga$title,
    source    = ga$source,
    lon0 = lon[1], dlon = if (length(lon)>1) lon[2]-lon[1] else 0.5, nlon = length(lon),
    lat0 = lat[1], dlat = if (length(lat)>1) lat[2]-lat[1] else 0.5, nlat = length(lat),
    n_valid = length(ok),
    n_cells = length(y),
    vmin = if (length(v)) min(v) else NULL,
    vmax = if (length(v)) max(v) else NULL,
    mtime = as.character(file.info(file.path(d,"extracted_yield.nc"))$mtime),
    dup_of = NA_character_,
    idx = as.integer(ok - 1L),                 # 0-based flat index, i + j*nlon
    val = v
  )
})
names(out) <- dirs

# --- integrity check: has one study's grid been written into another's file? --
# Re-running a single section of extract_data.R with a stale `miscanthus_cells`
# in the workspace silently produces a file with the right axes, title and
# attributes but another study's values. Nothing downstream would catch it, so
# check every pair for identical content and flag the more recently written
# file of any duplicate pair.
val_at <- function(z, lon, lat) {
  i <- round((lon - z$lon0) / z$dlon) + 1
  j <- round((lat - z$lat0) / z$dlat) + 1
  if (i < 1 || i > z$nlon || j < 1 || j > z$nlat) return(NA_real_)
  k <- match((i - 1L) + (j - 1L) * z$nlon, z$idx)
  if (is.na(k)) NA_real_ else z$val[k]
}

for (a in seq_along(out)) for (b in seq_along(out)) {
  if (b <= a) next
  A <- out[[a]]; B <- out[[b]]
  if (A$n_valid == 0 || A$n_valid != B$n_valid) next
  i <- A$idx %% A$nlon; j <- (A$idx - i) %/% A$nlon
  lons <- A$lon0 + i * A$dlon; lats <- A$lat0 + j * A$dlat
  other <- vapply(seq_along(lons), function(k) val_at(B, lons[k], lats[k]), 0)
  if (!any(is.na(other)) && isTRUE(all.equal(as.numeric(A$val), other))) {
    newer <- if (is.na(A$mtime) || is.na(B$mtime) || A$mtime >= B$mtime) a else b
    older <- if (newer == a) b else a
    out[[newer]]$dup_of <- out[[older]]$key
    cat("!! ", out[[newer]]$key, " has content identical to ",
        out[[older]]$key, " - flagged as suspect\n", sep = "")
  }
}

js <- toJSON(unname(out), auto_unbox = TRUE, digits = 6, na = "null")
writeLines(paste0("window.YIELD_DATA = ", js, ";"),
           "../miscanthus-yield-maps-viz-demo/yield_data.js")
cat("wrote ", length(out), " datasets (",
    sum(vapply(out, function(z) z$n_valid > 0 && is.na(z$dup_of), TRUE)),
    " usable)\n", sep = "")
