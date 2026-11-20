#!/bin/bash
# Builds minimal app / flow fixtures and the TLS certificate for the mock.
set -euo pipefail
mkdir -p /certs /work/flows /tmp/apk
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=api.testingbot.com" \
  -addext "subjectAltName=DNS:api.testingbot.com,DNS:registry.npmjs.org" \
  -keyout /certs/key.pem -out /certs/cert.pem 2>/dev/null
cd /tmp/apk && echo '<manifest/>' > AndroidManifest.xml && echo dex > classes.dex
zip -q /work/app.apk AndroidManifest.xml classes.dex
zip -q /work/test.apk AndroidManifest.xml classes.dex
for f in login checkout search profile; do
  printf 'appId: com.example\n---\n- launchApp\n- tapOn: "%s"\n' "$f" > /work/flows/$f.yaml
done
