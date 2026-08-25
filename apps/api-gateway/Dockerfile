FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json apps/api-gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/persistence/package.json packages/persistence/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api-gateway apps/api-gateway
COPY packages/contracts packages/contracts
COPY packages/persistence packages/persistence
RUN pnpm --filter @encois/api-gateway... build
RUN cp -R apps/api-gateway/dist /server-dist
RUN pnpm --filter @encois/api-gateway build:scripts
RUN cp -R apps/api-gateway/dist/scripts /local-seed-scripts
RUN pnpm deploy --legacy --filter @encois/api-gateway --prod /out
RUN rm -rf /out/dist && cp -R /server-dist /out/dist

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ARG ENCOIS_VERSION=1.0.0
LABEL org.opencontainers.image.title="Encois API Gateway" \
      org.opencontainers.image.version="${ENCOIS_VERSION}"
COPY --from=build /out ./
ENV HOST=0.0.0.0
ENV PORT=8080
ENV ENCOIS_VERSION=${ENCOIS_VERSION}
USER node
EXPOSE 8080

FROM runtime AS local-seed

COPY --from=build /local-seed-scripts /app/dist/scripts
CMD ["node", "dist/scripts/seed-local.js"]

FROM runtime AS production

CMD ["node", "dist/server.js"]
