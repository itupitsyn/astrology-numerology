# web

Nuxt/Nitro layer: the API, the database, and the LLM calls. It is the only
thing that talks to `astro-service`, to Postgres, and to the model.

## Daily forecast API (for the Telegram bot)

The bot stores nothing but a Telegram user id. Profiles live here, because the
web app that collects them already talks to this database and the daily cache is
keyed on the profile's identity and version.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/bot/profile-status` | `X-API-Key` | Does this user have usable data, and where to send them if not |
| POST | `/api/bot/daily` | `X-API-Key` | Today's forecast for a Telegram user |
| GET | `/api/bot/daily/:id` | `X-API-Key` | Poll a reading while its text generates |
| POST | `/api/bot/daily/:id/feedback` | `X-API-Key` | 👍 / 👎 on a forecast |
| GET | `/api/profile` | Telegram `initData` | Prefill for the setup form |
| POST | `/api/profile` | Telegram `initData` | Write the once-only user data |

The form behind the last two is `/setup` (`app/pages/setup.vue`), opened as a
Telegram Mini App. It asks for a name, optional full name, birth date and time,
birth place, and — separately — where the user lives now. Re-opening it prefills
from `GET /api/profile`, so a second visit is editing rather than starting over.

### Unknown birth time

The form has an "I don't know my birth time" checkbox. Ticking it stores noon as
a placeholder **and** sets `birth_time_unknown`, which makes `/api/bot/daily`
send `houses_known: false` to astro-service. The forecast then omits houses and
the angles entirely rather than computing them: houses sweep the whole zodiac
every 24 hours, so from a guessed time they would not be approximate, they would
be fabricated. Everything time-independent — planetary transits, lunar phase,
ingresses, void-of-course — is unaffected.

Toggling the checkbox changes the profile version, which invalidates any
forecast already generated for today.

### The flow

```
bot ──► POST /api/bot/daily { telegramId }
         │
         ├─ 409 { needsProfile, setupUrl } ──► bot sends the user to the web app
         │
         ├─ 200 { status: "ready",   forecast, numerology, text }   ── done
         │
         └─ 200 { status: "pending", forecast, numerology, text: null }
                  │  bot sends the facts NOW, then polls:
                  └─► GET /api/bot/daily/:id  until status is "ready", then edits
```

`POST /api/bot/daily` also takes `generate: false`, which returns the facts
while causing no work at all: no slot claimed, no model run, nothing written —
the response carries `id: null` because there is no row. That is what makes
inline mode safe, since Telegram fires an inline query on every keystroke and
generating there would mean a GPU job per letter.

`/api/bot/profile-status` exists so `/start` and `/settings` can ask "does this
user have data" without side effects. Probing with `/api/bot/daily` would answer
the same question, but it also claims a generation slot — a bare "hello" would
quietly cost a model run.

**Why two phases.** The transits, events and numerology cost milliseconds and no
GPU; the prose costs a 35B model on one card. Waiting for the second before
sending the first would leave the user staring at a spinner for the whole
generation — and if the model is down they would get nothing at all, even though
a complete, useful answer was ready in 200 ms.

### What stops two taps from starting two generations

`daily_readings` carries a unique index on `(profile_id, local_date)`, and the
slot is claimed *before* generation begins:

- first caller `INSERT ... ON CONFLICT DO NOTHING` — exactly one gets a row back;
- later callers fall through to an `UPDATE ... WHERE`, which is itself the lock,
  and only reclaims when the slot is genuinely free: the profile changed
  underneath it, the last attempt failed, or a claim went stale.

A claim expires after `STALE_PENDING_MS` (5 min), so a process restart mid
generation cannot leave a user's day wedged in `pending` forever.

The race is covered by `server/utils/daily.claim.test.ts`, which runs against a
real Postgres — the guarantee comes from the database, so a mock would prove
nothing. Those cases skip unless `TEST_DATABASE_URL` is set:

```bash
docker compose up -d postgres
NUXT_DATABASE_URL=postgres://astro:astro@localhost:5433/astro bun run db:migrate
TEST_DATABASE_URL=postgres://astro:astro@localhost:5433/astro bun run test
```

### Auth

- **The bot** presents a shared secret (`NUXT_BOT_API_KEY`) as `X-API-Key`.
  `/api/bot/*` can start a GPU job, so unlike the older public endpoints it is
  not left open.
- **The web app** runs inside Telegram and sends its signed `initData` in the
  `X-Telegram-Init-Data` header. Verifying that HMAC against the bot token
  yields a trustworthy user id — no token table of our own, and no way for a
  caller to write into someone else's profile.

### The day is the user's day

Everything is keyed on the local calendar date at the user's **current**
location, which is stored separately from the birth place. Slice the day at the
server's midnight instead and a user in Vladivostok reading at 09:00 gets
yesterday's sky. The current place is also what shifts every event time: the same
Moon ingress is 19:02 in Vladivostok and 10:02 in Lisbon.

### LLM budget

The model runs on one GPU. `server/utils/llm/limiter.ts` bounds concurrency
(`NUXT_LLM_CONCURRENCY`, default 1) with a FIFO queue and a hard wait cap
(`NUXT_LLM_QUEUE_MAX_WAIT_MS`); a caller past the cap is rejected as busy rather
than left hanging. Same shape as the geocoding limiter in `astro-service`. It is
per-process, and exact only while Nitro runs a single instance.

A generation that fails for any reason — model down, queue full, empty
completion — marks the row `failed`, which is precisely what lets the next
request reclaim the slot and try again.

---

## Nuxt

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.
