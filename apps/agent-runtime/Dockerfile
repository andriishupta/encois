FROM golang:1.26 AS build

WORKDIR /src
COPY apps/agent-runtime/go.mod apps/agent-runtime/go.sum ./apps/agent-runtime/
COPY packages/contracts/go.mod packages/contracts/go.sum ./packages/contracts/
RUN cd apps/agent-runtime && go mod download
COPY packages/contracts/*.go ./packages/contracts/
COPY packages/contracts/schemas ./packages/contracts/schemas
COPY apps/agent-runtime ./apps/agent-runtime
RUN cd apps/agent-runtime && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/agent-runtime ./cmd/agent-runtime

FROM gcr.io/distroless/static-debian12:nonroot

ARG ENCOIS_VERSION=1.0.0
LABEL org.opencontainers.image.title="Encois Agent Runtime" \
      org.opencontainers.image.version="${ENCOIS_VERSION}"

COPY --from=build /out/agent-runtime /agent-runtime
ENV PORT=8080
ENV ENCOIS_VERSION=${ENCOIS_VERSION}
USER nonroot:nonroot
ENTRYPOINT ["/agent-runtime"]
