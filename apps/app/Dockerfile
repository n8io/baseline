# syntax=docker/dockerfile:1
# One image, three entries, picked by the last argument of the command:
#   server:  the CMD below (build/server/index.js)
#   worker:  [... same flags ..., "src/worker.ts"]
#   migrate: [... same flags ..., "src/migrate.ts"]
# Runner: allow a 30 s grace period; probe /livez and /readyz on HEALTH_PORT (9000);
# run the migrate entry once before rollout; server and worker may then start in any order and scale independently;
# the load balancer must speak HTTP/2 and allow long-lived responses (SSE);
# give every entry OP_SERVICE_ACCOUNT_TOKEN and outbound HTTPS to 1Password; secrets are fetched at boot.
# Build: docker build .

FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS build
WORKDIR /app
RUN npm install --global pnpm@12.17.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --offline --store-dir /pnpm/store \
	&& pnpm run build
# Production dependencies only, without build-only peers (auto-install-peers=false in .npmrc).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	mkdir /prod \
	&& cp package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /prod/ \
	&& cd /prod \
	&& pnpm install --prod --frozen-lockfile --offline --store-dir /pnpm/store --package-import-method copy

FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39
WORKDIR /app
ENV NODE_ENV=production APP_ENV=production
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/src ./src
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/.env.schema /app/.env.production ./
USER node
EXPOSE 3000 9000
CMD ["node", "--import", "varlock/auto-load", "--import", "@n8io/baseline-telemetry/register", "--experimental-loader=@opentelemetry/instrumentation/hook.mjs", "build/server/index.js"]
