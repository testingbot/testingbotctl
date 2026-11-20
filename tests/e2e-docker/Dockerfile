# End-to-end harness: the built CLI against a mock TestingBot API, in a real
# pseudo-terminal. See run.sh.
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl python3 python3-pyte python3-pexpect zip bash zsh fish ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY dist ./dist
RUN ln -s /cli/dist/index.js /usr/local/bin/testingbot && chmod +x /cli/dist/index.js
COPY harness /harness
RUN /harness/fixtures.sh
ENV NODE_EXTRA_CA_CERTS=/certs/cert.pem TB_KEY=key TB_SECRET=secret
WORKDIR /work
ENTRYPOINT ["/harness/entrypoint.sh"]
