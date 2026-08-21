FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps/dashboard apps/dashboard
COPY packages/contracts packages/contracts
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN pnpm --filter @encois/dashboard... build

FROM nginx:1.29-alpine

COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 8080
