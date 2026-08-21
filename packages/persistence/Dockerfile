FROM node:22-bookworm-slim

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/persistence/package.json packages/persistence/package.json
RUN pnpm install --frozen-lockfile --filter @encois/persistence...

COPY packages/persistence packages/persistence

ENTRYPOINT ["pnpm", "--filter", "@encois/persistence", "db:migrate"]
