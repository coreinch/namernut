# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copying only the manifest files first means this layer (and the
# `npm ci` below) stays cached across builds where only application
# source changed, not dependencies.
COPY package*.json ./

# Full install (devDependencies included) — `next build` itself needs
# typescript and @tailwindcss/postcss to compile, unlike cicd-lab's
# plain-JS app which had no build step at all.
RUN npm ci

COPY . .

# Runtime secrets (BRAVE_API_KEY, KILOCODE_API_KEY, INSTAGRAM_SESSION_ID)
# are read from process.env at request time by the API routes, not at
# build time, and none of this app's env vars are NEXT_PUBLIC_-prefixed
# — so the build needs no secrets and produces one image usable across
# environments, per Next.js's self-hosting guidance.
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Standalone's server.js binds to this host; 0.0.0.0 is required so the
# Docker port mapping (see docker-compose.prod.yml.j2) can reach it —
# it defaults to localhost-only otherwise.
ENV HOSTNAME=0.0.0.0

# output: "standalone" (next.config.ts) traces only the files and
# node_modules each route actually needs into .next/standalone, plus a
# self-contained server.js — much smaller than shipping the full
# node_modules tree. .next/static and public/ are deliberately excluded
# from that trace and must be copied in separately, or CSS/JS assets and
# static files 404 at runtime.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Official node images ship a non-root "node" user (uid 1000) for this
# purpose — the runtime stage never needs root.
USER node

EXPOSE 3000

CMD ["node", "server.js"]
