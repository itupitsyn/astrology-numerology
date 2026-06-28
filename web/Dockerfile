# --- base: deps + source (also used by the `migrate` compose service) ---
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .

# --- build: produce the Nitro node-server output ---
FROM base AS build
RUN bun run build

# --- runtime: slim node image serving .output ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
