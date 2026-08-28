FROM node:24.19-bookworm-slim

ARG ENCOIS_VERSION=1.0.0
LABEL org.opencontainers.image.title="Encois Database Migrations" \
      org.opencontainers.image.version="${ENCOIS_VERSION}"

WORKDIR /workspace
RUN corepack enable
ENV NODE_ENV=production
ENV ENCOIS_VERSION=${ENCOIS_VERSION}
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile --filter @encois/database...

COPY packages/database packages/database

ENTRYPOINT ["pnpm", "--filter", "@encois/database", "db:migrate"]
