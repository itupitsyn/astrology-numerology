# The bot is plain TypeScript run directly by Bun — no build step, because
# there is nothing to bundle: it is a long-polling loop and an HTTP client.
FROM oven/bun:1 AS runtime

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src ./src

ENV NODE_ENV=production

# No port is exposed: long polling means the bot dials out to Telegram and
# never needs to be reachable from outside.
CMD ["bun", "src/index.ts"]
