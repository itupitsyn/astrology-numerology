# astro-service

Astrology + geocoding microservice for the astro-numerology app.

- **Framework:** FastAPI
- **Astrology:** [kerykeion](https://github.com/g-battaglia/kerykeion) + [pyswisseph](https://pypi.org/project/pyswisseph/) (Swiss Ephemeris)
- **Geocoding:** Nominatim — the public OSM instance by default, rate limited
  and cached server-side (see [Geocoding budget](#geocoding-budget))
- **Timezones:** resolved offline from coordinates via `timezonefinder`

## Setup

```bash
cd astro-service
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# bash:                source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set a real contact in NOMINATIM_USER_AGENT
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
| POST   | `/horary`  | Question + moment → horary chart + deterministic verdict |

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

### Example: horary judgment

```bash
curl -X POST http://localhost:8000/horary \
  -H "Content-Type: application/json" \
  -d '{
        "question": "Получу ли я эту работу?",
        "quesited_house": 10,
        "ask_now": true,
        "latitude": 55.7558, "longitude": 37.6173
      }'
```

Cast for the **moment the question is received** using **Regiomontanus** houses
(the horary standard, vs. Placidus for natal). Set `ask_now: true` to use the
current time at the location, or pass explicit `year..minute`. `quesited_house`
is the house the question is about (2=money, 7=partner, 10=career, ...).

The verdict (`yes` / `no` / `qualified`), significators, essential dignities,
Moon condition, receptions and radicality flags are all computed
**deterministically in Python** (`horary.py` + `dignities.py`) from the
classical rules — an LLM only narrates this result, it never decides it.

## Geocoding budget

Geocoding runs against the **public OSM Nominatim**, whose usage policy allows
at most **1 request per second per application** — counted across all users,
not per browser. A debounce in the frontend cannot enforce that, so the budget
is managed here, in one shared place (`geocoding.py`):

| Mechanism | What it does |
|-----------|--------------|
| FIFO queue (`_RateLimiter`) | Spaces outbound calls by `NOMINATIM_RATE_LIMIT`. Rejects with **503 + `Retry-After`** once the queue would exceed `GEOCODING_QUEUE_MAX_WAIT`, rather than letting callers pile up |
| TTL + LRU cache (`_TTLCache`) | Birth places repeat heavily across users; cache hits cost no budget. This is what keeps 1 req/s from being the app's throughput ceiling. Empty results are cached too, so a typo cannot spend the budget on every keystroke |
| In-flight coalescing | Identical concurrent queries share a single upstream request |

Two caveats worth knowing:

- **All three are per-process**, and exact only while uvicorn runs a single
  worker — which is how the Dockerfile starts it. Adding `--workers` gives each
  worker its own budget and breaks the guarantee; the limiter would have to
  move somewhere shared.
- The public instance returns **403 for an empty or library-default
  User-Agent**, which looks exactly like an IP ban. Always set a real
  `NOMINATIM_USER_AGENT` with a contact.

### Two instances

`NOMINATIM_FALLBACK_URL` adds a secondary instance. With
`GEOCODING_MERGE_SOURCES=true` (the default) both are queried concurrently and
the results are interleaved and de-duplicated, rather than stopping at the
first non-empty answer.

That default matters if the primary ever becomes a *regional* instance: "take
the primary's results if it found anything" silently truncates the world to one
region. Someone born in Odessa, Texas types "Odessa", a CIS instance answers
with Odessa, Ukraine, and the search stops — the entry looks right, so it gets
picked, and the chart is computed from the wrong coordinates and the wrong
timezone. Nothing errors out. Interleaving rather than sorting by Nominatim's
`importance` is deliberate: two instances can be built with different ranking
data, so their scores are not comparable.

## Horary engine & tests

The deterministic core lives in:

- `dignities.py` — traditional dignity tables (rulers, exaltations,
  triplicities, Egyptian terms, Chaldean faces) + Lilly scoring.
- `horary.py` — chart casting, aspect geometry (applying/separating,
  perfection before sign exit), Moon void-of-course, and the verdict engine
  (perfection / translation / collection / prohibition).

Accuracy tests run without `pytest`:

```bash
python test_horary.py      # dignity tables, aspect geometry, verdict scenarios
python test_reference.py   # ephemeris/house/significator wiring + fixtures
```

- `test_horary.py` — dignity tables vs. textbook facts, aspect geometry vs.
  hand-built positions, and **verdict scenarios** that isolate each judgment
  mode (direct / translation / collection / prohibition / refranation /
  combustion / besiegement / void Moon).
- `test_reference.py` — the *astronomical/wiring* layer that can be checked
  objectively: kerykeion positions vs. raw Swiss Ephemeris, the Regiomontanus
  Ascendant vs. an independent `swe.houses_ex`, significator = ruler of the
  Ascendant, and the Sun's sign vs. the known date. It also holds a
  `REFERENCE_CHARTS` fixture table — drop real, expert-judged horary charts
  there with `expect_verdict=` to turn it into whole-chart verdict calibration.

The geocoding tests do need `pytest` (they assert on raised exceptions), but
not `pytest-asyncio` — each async case is driven through `asyncio.run`:

```bash
pip install pytest
python -m pytest test_geocoding.py -q   # rate limiter, cache, source merge
```

## Notes

- Chart computation is **fully offline**: kerykeion runs with `online=False`
  and the caller provides coordinates (from `/geocode`), so the only outbound
  traffic is geocoding.
- `requirements.txt` pins `kerykeion==4.26.2`. If you upgrade across a major
  version, re-check the `AstrologicalSubject` constructor and point attribute
  names in `ephemeris.py`.
