FROM node:24.19-bookworm-slim

ARG ENCOIS_VERSION=1.0.0
LABEL org.opencontainers.image.title="Encois Persistence Migrations" \
      org.opencontainers.image.version="${ENCOIS_VERSION}"

WORKDIR /workspace
RUN corepack enable
ENV NODE_ENV=production
ENV ENCOIS_VERSION=${ENCOIS_VERSION}
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/persistence/package.json packages/persistence/package.json
RUN pnpm install --frozen-lockfile --filter @encois/persistence...

COPY packages/persistence packages/persistence

ENTRYPOINT ["pnpm", "--filter", "@encois/persistence", "db:migrate"]
