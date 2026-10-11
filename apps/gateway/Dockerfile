# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/gateway/Dockerfile .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm i -g pnpm@10.34.6
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @nonna/gateway build \
  && pnpm --filter @nonna/gateway deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 8787
CMD ["node", "dist/index.js"]
