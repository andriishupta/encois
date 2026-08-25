FROM eclipse-temurin:21-jre AS java-runtime

FROM node:22-bookworm-slim

ARG ENCOIS_VERSION=1.0.0
LABEL org.opencontainers.image.title="Encois Firebase Auth Emulator" \
      org.opencontainers.image.version="${ENCOIS_VERSION}"

COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk

ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global firebase-tools@15.28.1

WORKDIR /firebase
ENV ENCOIS_VERSION=${ENCOIS_VERSION}
COPY docker/firebase/firebase.json ./firebase.json
COPY docker/firebase/storage.rules ./storage.rules

EXPOSE 4000 9099 9199

CMD ["firebase", "emulators:start", "--only", "auth,storage", "--project", "demo-encois", "--config", "/firebase/firebase.json", "--import", "/firebase/data", "--export-on-exit", "/firebase/data"]
