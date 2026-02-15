# ── Build stage ──
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.build.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──
FROM node:22-alpine

WORKDIR /app

# Claude CLI must be installed in the container separately.
# See README.md for instructions.

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist/ ./dist/

ENV PORT=8888
ENV HOST=0.0.0.0

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8888/health || exit 1

CMD ["node", "dist/index.js"]
