# Integrator sandbox: platform-owned image holding git, bun and the protected verifier.
# Contributor code executes under a separate UID in disposable snapshots.
FROM --platform=linux/amd64 debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl unzip ca-certificates util-linux procps && rm -rf /var/lib/apt/lists/* && curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
ENV FLAREGIT_REQUIRE_ISOLATION=1
WORKDIR /opt/flaregit
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src ./src
