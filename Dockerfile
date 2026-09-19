# syntax=docker/dockerfile:1
#
# Single-container Railway deploy:
#   - Vite client  -> /srv/web
#   - C++ relay    -> /usr/local/bin/game_server
#   - Caddy listens on $PORT, serves the site, and proxies /ws to the relay.

# ---- 1. Web client ----
FROM node:22-alpine AS web
WORKDIR /web
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src ./src
COPY public ./public
RUN pnpm build

# ---- 2. C++ relay ----
FROM alpine:3.20 AS server
RUN apk add --no-cache build-base cmake
WORKDIR /server
COPY server/ ./
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=g++ \
    && cmake --build build -j

# ---- 3. Caddy + relay ----
FROM caddy:2-alpine AS runtime
ENTRYPOINT []
RUN apk add --no-cache libstdc++ libgcc
COPY --from=web /web/dist /srv/web
COPY --from=server /server/build/game_server /usr/local/bin/game_server
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /start.sh
RUN chmod +x /start.sh
EXPOSE 8080
CMD ["/start.sh"]
