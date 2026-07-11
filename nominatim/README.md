# Self-hosted Nominatim (CIS + Europe)

Geocoding backend for the astro-numerology app, meant to run on its **own
instance** (a Proxmox VM), separate from the application stack.

The app's `astro-service` treats this as the **primary** geocoder and falls
back to a secondary instance / the public OSM Nominatim for the rest of the
world (see `NOMINATIM_FALLBACK_URL` in the root `.env`).

## What's covered

`europe-latest` + the Asian-filed CIS states (Caucasus + Central Asia):

- All of Europe **including Russia, Ukraine, Belarus, the Baltics, Moldova**
- Armenia, Azerbaijan, Georgia
- Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan, Uzbekistan

Anything outside this set resolves via the app's fallback, not here.

## Sizing (this data set)

| Resource | Need |
|----------|------|
| Disk (SSD) | ~450–550 GB for the DB; keep headroom during import |
| RAM | 16 GB is comfortable for this region |
| vCPU | 2 works; more = faster import |
| Import time | a few hours on SSD |

Comfortably fits your 1 TB SSD / 16 GB / 2-core VM.

## Setup

```bash
# 1. Install osmium (host), then download + merge the regions.
sudo apt-get install -y osmium-tool
./prepare-pbf.sh                 # -> data/cis-europe.osm.pbf

# 2. Optional: set password / threads.
cp .env.example .env

# 3. Import + serve. First boot imports (hours); watch the log.
docker compose up -d
docker compose logs -f nominatim
```

When the log reaches `Import finished` the API is live on `:8080`.

## Verify

```bash
curl "http://localhost:8080/status?format=json"
curl "http://localhost:8080/search?q=Москва&format=jsonv2&limit=1"
```

## Point the app at it

In the app's root `.env`:

```
NOMINATIM_URL=http://<this-vm-host-or-ip>:8080
NOMINATIM_FALLBACK_URL=https://nominatim.openstreetmap.org
```

## Updating the data

Re-run `./prepare-pbf.sh` (it re-downloads the region files), then recreate the
container so it re-imports:

```bash
docker compose down -v      # drops the imported DB volume
docker compose up -d
```

For incremental updates instead of a full re-import, look into the mediagis
image's `REPLICATION_URL` / `UPDATES` options — heavier to operate, usually not
worth it for a birth-place geocoder.

## Notes

- The persisted DB volume path (`/var/lib/postgresql/16/main`) is tied to the
  image's Postgres major version. If you change the image tag, verify the path
  with `docker exec nominatim ls /var/lib/postgresql/` and update the compose
  volume, or the container will silently re-import every restart.
- If the import OOMs, raise `shm_size` in `docker-compose.yml`.
- To shrink the DB, uncomment `IMPORT_STYLE: address` (drops POIs; fine if you
  only geocode cities/addresses).
