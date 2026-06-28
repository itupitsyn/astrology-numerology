# astro-service

Astrology + geocoding microservice for the astro-numerology app.

- **Framework:** FastAPI
- **Astrology:** [kerykeion](https://github.com/g-battaglia/kerykeion) + [pyswisseph](https://pypi.org/project/pyswisseph/) (Swiss Ephemeris)
- **Geocoding:** self-hosted Nominatim (no third-party APIs)
- **Timezones:** resolved offline from coordinates via `timezonefinder`

## Setup

```bash
cd astro-service
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# bash:                source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # adjust NOMINATIM_URL if needed
```

## Run

```bash
uvicorn main:app --reload --port 8000
# or: python main.py
```

Interactive API docs: http://localhost:8000/docs

## Endpoints

| Method | Path       | Description                                          |
|--------|------------|------------------------------------------------------|
| GET    | `/health`  | Liveness + Nominatim reachability                    |
| POST   | `/geocode` | Free-form place → coordinates + IANA timezone        |
| POST   | `/natal`   | Birth data → full natal chart (planets, houses, ...) |

### Example: geocode

```bash
curl -X POST http://localhost:8000/geocode \
  -H "Content-Type: application/json" \
  -d '{"query": "Москва, Россия", "limit": 1}'
```

### Example: natal chart

```bash
curl -X POST http://localhost:8000/natal \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Test",
        "year": 1990, "month": 5, "day": 15,
        "hour": 14, "minute": 30,
        "latitude": 55.7558, "longitude": 37.6173,
        "timezone": "Europe/Moscow",
        "city": "Moscow"
      }'
```

If `timezone` is omitted it is derived from the coordinates.

## Notes

- The service is **fully offline**: kerykeion runs with `online=False` and the
  caller provides coordinates (from `/geocode`), so no external network is used.
- `requirements.txt` pins `kerykeion==4.26.2`. If you upgrade across a major
  version, re-check the `AstrologicalSubject` constructor and point attribute
  names in `ephemeris.py`.
