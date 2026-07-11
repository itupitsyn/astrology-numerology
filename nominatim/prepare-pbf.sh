#!/usr/bin/env bash
#
# Download Geofabrik regions for CIS + Europe and merge them into a single
# PBF for a Nominatim import: data/cis-europe.osm.pbf
#
# Requires osmium-tool on the host:
#   Debian/Ubuntu:  sudo apt-get install -y osmium-tool
#   (or run osmium via any osmium-tool container against ./data)
#
# europe-latest already includes Russia, Ukraine, Belarus, the Baltics and
# Moldova. Georgia is filed by Geofabrik under Europe; the remaining CIS states
# (Armenia, Azerbaijan + Central Asia) are under Asia. We add them all
# explicitly. Everything else is handled by the app's fallback instance.
set -euo pipefail

cd "$(dirname "$0")"
DATA_DIR="./data"
OUT="$DATA_DIR/cis-europe.osm.pbf"
BASE="https://download.geofabrik.de"

REGIONS=(
  "europe-latest.osm.pbf"
  "asia/armenia-latest.osm.pbf"
  "asia/azerbaijan-latest.osm.pbf"
  "europe/georgia-latest.osm.pbf"
  "asia/kazakhstan-latest.osm.pbf"
  "asia/kyrgyzstan-latest.osm.pbf"
  "asia/tajikistan-latest.osm.pbf"
  "asia/turkmenistan-latest.osm.pbf"
  "asia/uzbekistan-latest.osm.pbf"
)

mkdir -p "$DATA_DIR"

FILES=()
for r in "${REGIONS[@]}"; do
  fname="$(basename "$r")"
  dest="$DATA_DIR/$fname"
  if [[ -f "$dest" ]]; then
    echo ">> $fname already present, skipping download"
  else
    echo ">> downloading $r"
    curl -fL --retry 3 -o "$dest" "$BASE/$r"
  fi
  FILES+=("$dest")
done

echo ">> merging ${#FILES[@]} regions -> $OUT (streaming, takes a few minutes)"
osmium merge "${FILES[@]}" -o "$OUT" --overwrite

echo ">> done: $OUT ($(du -h "$OUT" | cut -f1))"
echo ">> now run: docker compose up -d && docker compose logs -f nominatim"
