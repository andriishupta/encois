FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global firebase-tools@15.28.1

WORKDIR /firebase
COPY firebase.json ./firebase.json

EXPOSE 4000 9099

CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-encois", "--config", "/firebase/firebase.json"]
