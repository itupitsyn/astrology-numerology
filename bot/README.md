# bot

Telegram bot: the front door to the daily forecast.

- **Runtime:** Bun, TypeScript, [grammY](https://grammy.dev)
- **Delivery:** long polling — the bot dials out, so it needs no public address
  and works behind NAT. Moving to a webhook later is a change to `src/index.ts`.

It holds no astrology, no database and no user data. It knows a Telegram id and
calls `/api/bot/*` on the Nuxt layer; everything it shows comes from there.

## Commands

| Command | What it does |
|---------|--------------|
| `/start` | Greets, and sends a new user to the setup form |
| `/today` | The forecast for today |
| `/settings` | Opens the form to change birth data or current city |
| `/help` | Short reference |

Ratings (👍/👎) under each forecast go to `/api/bot/daily/:id/feedback` — the
same A/B signal the natal and horary readings collect.

## Inline mode

Typing `@your_bot` in any chat offers the day as something short enough to drop
into a conversation that did not ask for it:

```
✦ 26 августа · 🌙 Водолей, полнолуние 97% · 🔢 личный день 1     ← "Кратко" (~60 chars)

✦ 26 августа · 🌙 Водолей, полнолуние 97% · 🔢 личный день 1     ← "Главное за день"
• 07:00 · Луна в тригоне к натальному MC
• 03:47 · Луна в квадрате к натальному Меркурию
• 01:47 · Марс в соединении к натальному Юпитеру
```

Enable it in @BotFather first: `/setinline`.

Three things this mode has to get right, all in `src/inline.ts`:

- **A query arrives on every keystroke.** So it calls the API with
  `generate: false`: no slot claimed, no model run, nothing written. Otherwise
  typing a word would queue a GPU job per letter. A short per-user memo
  (`MEMO_TTL_MS`) keeps most keystrokes off astro-service as well.
- **The answer must be immediate**, inside Telegram's few seconds — which rules
  out the prose entirely. That suits the brief: a wall of generated text pasted
  into someone else's chat is the spam worth avoiding. Inline sends facts only.
- **Results are per-user**, so `is_personal: true` is mandatory. Without it
  Telegram may cache one person's natal forecast and serve it to somebody else
  typing the same query.

Only the `today` layer appears — a Pluto transit that runs for two years is
noise in a one-line message. A user with no profile gets an empty result list
and a button into the bot (`/start setup`).

## The two-phase answer

```
/today
  │
  ├─ no profile ─────► "fill this in", with a Mini App button to /setup
  │
  └─ POST /api/bot/daily
       │
       ├─ ready   ─► one message: facts + prose + 👍/👎
       │
       └─ pending ─► facts sent NOW ("✍️ Пишу разбор…"),
                     then GET /api/bot/daily/:id every 2s,
                     and the prose is edited into the same message
```

The transits, events and numerology cost milliseconds and no GPU; the prose is a
35B model on one card. Waiting for the second before sending the first would
leave the user on a spinner for the whole generation — and if the model is down
they would get nothing, even though a complete answer was ready in 200 ms.

So the failure modes degrade instead of breaking:

| What happened | What the user sees |
|---------------|--------------------|
| Model down or queue full | Facts, plus "разбор словами сейчас не получился" |
| Still generating after `POLL_TIMEOUT_MS` | Facts, plus "загляните через несколько минут" |
| Facts + prose exceed Telegram's 4096 chars | Two messages, never a truncated reading |

`/start` and `/settings` ask `POST /api/bot/profile-status`, not
`/api/bot/daily`: the latter would answer the same question but also claim a
generation slot, so a bare "hello" would quietly cost a model run.

## Configuration

| Variable | Required | Meaning |
|----------|----------|---------|
| `BOT_TOKEN` | yes | From @BotFather. **Must be the same bot** as the web layer's `NUXT_TELEGRAM_BOT_TOKEN`, which verifies Mini App `initData` against it |
| `API_BASE_URL` | yes | Origin of the Nuxt layer (`http://web:3000` inside compose) |
| `BOT_API_KEY` | yes | Shared secret sent as `X-API-Key`; matches `NUXT_BOT_API_KEY` |
| `POLL_INTERVAL_MS` | no | Default 2000 |
| `POLL_TIMEOUT_MS` | no | Default 180000 |
| `API_TIMEOUT_MS` | no | Default 30000 |

## Run

```bash
cd bot
bun install
BOT_TOKEN=... API_BASE_URL=http://localhost:3000 BOT_API_KEY=... bun run dev
```

Or as part of the stack: `docker compose up -d bot`.

```bash
bun run test   # message rendering
```

## Mini App buttons need HTTPS

Telegram only opens Mini Apps over `https://`, and refuses `localhost`
outright. When `NUXT_APP_URL` is not an HTTPS address the bot sends the setup
link as plain text instead of a button, so local development still works rather
than failing with `BUTTON_URL_INVALID`.

## Types

`src/types.ts` mirrors the `/api/bot/*` responses from
`web/server/utils/daily.ts`. Mirrored rather than imported: the bot builds in its
own container with its own build context, and the source of truth on the other
side is server-only code. Same convention as the Nuxt layer's mirror of
astro-service's Python models.
