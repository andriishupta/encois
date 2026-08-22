FROM node:22-bookworm-slim

ARG ENCOIS_VERSION=1.0.0
LABEL org.opencontainers.image.title="Encois Firebase Auth Emulator" \
      org.opencontainers.image.version="${ENCOIS_VERSION}"

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global firebase-tools@15.28.1

WORKDIR /firebase
ENV ENCOIS_VERSION=${ENCOIS_VERSION}
COPY firebase.json ./firebase.json

EXPOSE 4000 9099

CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-encois", "--config", "/firebase/firebase.json"]
