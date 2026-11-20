#!/bin/bash
# End-to-end checks of the built CLI in Docker, against a mock TestingBot API.
#
#   tests/e2e-docker/run.sh build                 # npm run build + image
#   tests/e2e-docker/run.sh screen <scenario> [--cols N] [--term-env K=V...] -- testingbot ...
#   tests/e2e-docker/run.sh plain  <scenario> -- testingbot ...   # no TTY (CI-like)
#
# Scenarios (mock API behaviour): pass | fail | flaky | matrix.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
image=testingbot-cli-e2e

case "${1:-}" in
  build)
    (cd "$root" && npm run build >/dev/null)
    ctx="$(mktemp -d)"
    trap 'rm -rf "$ctx"' EXIT
    cp -R "$root/dist" "$root/package.json" "$root/package-lock.json" "$ctx/"
    cp -R "$here/harness" "$here/Dockerfile" "$ctx/"
    docker build -q -t "$image" "$ctx" >/dev/null
    echo "built $image"
    ;;
  screen|plain)
    mode="$1"; scenario="$2"; shift 2
    cols=100; envs=()
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do
      case "$1" in
        --cols) cols="$2"; shift 2 ;;
        --env) envs+=(-e "$2"); shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
      esac
    done
    shift
    common=(--rm --add-host api.testingbot.com:127.0.0.1 --add-host registry.npmjs.org:127.0.0.1
            -e MOCK_SCENARIO="$scenario" "${envs[@]+"${envs[@]}"}")
    if [ "$mode" = screen ]; then
      docker run "${common[@]}" -e TERM=xterm-256color "$image" \
        python3 /harness/screen.py --cols "$cols" --raw /tmp/raw.txt -- "$@"
    else
      docker run "${common[@]}" "$image" "$@"
    fi
    ;;
  *)
    sed -n '2,9p' "$0"; exit 2 ;;
esac
