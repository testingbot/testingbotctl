#!/bin/bash
# Starts the mock API for $MOCK_SCENARIO, then runs the given command.
set -uo pipefail
MOCK_LOG=/tmp/mock.log node /harness/mock-server.js &
for _ in $(seq 50); do (exec 3<>/dev/tcp/127.0.0.1/443) 2>/dev/null && break; sleep 0.1; done
exec "$@"
