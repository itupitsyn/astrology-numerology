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

## Notes

- The service is **fully offline**: kerykeion runs with `online=False` and the
  caller provides coordinates (from `/geocode`), so no external network is used.
- `requirements.txt` pins `kerykeion==4.26.2`. If you upgrade across a major
  version, re-check the `AstrologicalSubject` constructor and point attribute
  names in `ephemeris.py`.
