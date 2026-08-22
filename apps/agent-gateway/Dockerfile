FROM golang:1.26 AS build

WORKDIR /src
COPY apps/agent-gateway/go.mod apps/agent-gateway/go.sum ./apps/agent-gateway/
COPY packages/contracts/go.mod packages/contracts/go.sum ./packages/contracts/
RUN cd apps/agent-gateway && go mod download
COPY packages/contracts/*.go ./packages/contracts/
COPY packages/contracts/schemas ./packages/contracts/schemas
COPY apps/agent-gateway ./apps/agent-gateway
RUN cd apps/agent-gateway && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/agent-gateway ./cmd/agent-gateway

FROM gcr.io/distroless/static-debian12:nonroot

ARG ENCOIS_VERSION=1.0.0
LABEL org.opencontainers.image.title="Encois Agent Gateway" \
      org.opencontainers.image.version="${ENCOIS_VERSION}"

COPY --from=build /out/agent-gateway /agent-gateway
ENV PORT=8080
ENV ENCOIS_VERSION=${ENCOIS_VERSION}
USER nonroot:nonroot
ENTRYPOINT ["/agent-gateway"]
