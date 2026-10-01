# Integrator sandbox: platform-owned image holding git, bun and the protected verifier.
# Contributor/agent code is only ever checked out into /workspace and executed by the scrubbed runner.
FROM --platform=linux/amd64 debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl unzip ca-certificates && rm -rf /var/lib/apt/lists/* && curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
WORKDIR /opt/flaregit
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src ./src
