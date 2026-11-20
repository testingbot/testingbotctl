#!/bin/bash
# Full end-to-end sweep; writes one file per check to /out.
S="python3 /harness/screen.py --cols 100"
cd /work
export TERM=xterm-256color

# 1. Ghostty: links, tab progress, success animation, full banner then compact
TERM_PROGRAM=ghostty $S --raw /out/ghostty.raw -- testingbot maestro app.apk flows --device "Pixel 9" > /out/01-ghostty.txt
TERM_PROGRAM=ghostty $S -- testingbot whoami > /out/02-whoami.txt

# 2. CI: no TTY, no escape sequences, card still there
CI=true testingbot maestro app.apk flows --device "Pixel 9" > /out/03-ci.txt 2>&1; echo "exit $?" >> /out/03-ci.txt

# 3. --json: stdout is exactly one JSON document
testingbot maestro app.apk flows --device "Pixel 9" --json > /out/04-json.stdout 2> /out/04-json.stderr; echo "exit $?" >> /out/04-json.stderr

# 4. devices --real, list
$S -- testingbot devices --real > /out/05-devices.txt
$S -- testingbot list > /out/06-list.txt

# 5. init + bare run from a subdirectory
mkdir -p /proj/app/build/outputs/apk/debug /proj/.maestro /proj/src/deep
cp app.apk /proj/app/build/outputs/apk/debug/app-debug.apk; cp flows/*.yaml /proj/.maestro/
cd /proj && testingbot init > /dev/null && cd /proj/src/deep && $S -- testingbot maestro > /out/07-config-run.txt
cd /work

# 6. help and errors
$S -- testingbot > /out/08-root.txt
$S -- testingbot maestro --device-matrix "Pixel 9:15" --device "Pixel 9" app.apk flows > /out/09-error.txt
