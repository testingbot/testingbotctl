# End-to-end checks in Docker

Runs the built CLI in a real pseudo-terminal against a mock TestingBot API, to
check what users actually see: live tables, redraws, colours, escape codes.

The container maps `api.testingbot.com` and `registry.npmjs.org` to a local
HTTPS mock (`harness/mock-server.js`) whose self-signed certificate is trusted
through `NODE_EXTRA_CA_CERTS`, so the CLI runs unmodified.

```sh
tests/e2e-docker/run.sh build                      # npm run build + image
tests/e2e-docker/run.sh screen fail --cols 80 -- \
  testingbot maestro app.apk flows --device-matrix "Pixel 9:15,Galaxy S24:14"
tests/e2e-docker/run.sh plain pass -- testingbot maestro app.apk flows   # no TTY
```

`screen` feeds the output through a terminal emulator (pyte) and prints the
final screen plus scrollback; `--env TERM_PROGRAM=WezTerm` and the like make
the CLI believe it runs in a given terminal. Scenarios: `pass`, `fail`,
`flaky` (a flow passes on retry), `matrix`. `MOCK_SLOW=3` stretches runs,
`MOCK_LATEST_CLI=9.9.9` announces a newer CLI. Fixtures in `/work`: `app.apk`,
`test.apk`, `flows/`.

Scripted pty checks (pexpect), each run as
`tests/e2e-docker/run.sh plain pass -- python3 /harness/<script>`:

- `keys-test.py`: `o`, `d` and Ctrl-C during a live run.
- `background-test.py`: a run started with `&` in zsh and bash finishes
  instead of being stopped by the shell.
- `completion-shells.py`: Tab completion in bash, zsh and fish.
