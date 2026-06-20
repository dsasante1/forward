# Forward backend — container image for Google Cloud Run.
# Build from the repo root so the npm workspace (forward-core) is available:
#   docker build -f apps/server/Dockerfile -t forward-server .
FROM node:22-slim AS build
WORKDIR /repo

# OpenSSL is needed by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install the whole workspace (server depends on packages/shared = forward-core).
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN npm ci

# Build forward-core first (the contract), then the server.
RUN npm run build -w packages/shared
RUN npm run build -w apps/server

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/server ./apps/server

# Cloud Run sets PORT; the app reads it.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "apps/server/dist/main.js"]
