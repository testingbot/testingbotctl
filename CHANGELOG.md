# Changelog

All notable changes to `@testingbot/cli` are documented here. Releases are published to npm from GitHub releases.

## Unreleased

### Added

- `testingbot maestro` detects the repository URL, branch, commit and pull request in GitHub Actions, GitLab CI, Bitbucket Pipelines, Azure Pipelines and CircleCI and sends them as run metadata (`repoUrl` is new), so the dashboard can link to the commit and PR on any Git host. On a GitHub pull request the PR's head commit is used, not the merge commit. Explicit flags win.
- `testingbot espresso` and `testingbot xcuitest` take the same CI/CD metadata as `maestro`: `--branch`, `--pr-url`, `-m/--metadata` and the CI environment detection, through one shared code path.
- `--retry <count>`, `--download-artifacts [all|failed]` and `--artifacts-output-dir` for `testingbot espresso` and `testingbot xcuitest`. A retried run is started again on the uploaded app; the last attempt decides the exit code, the `--report` and the artifacts. Artifacts (video, logs, screenshots) are zipped with a folder per run, like `maestro`.

## 1.4.3 - 2026-10-27

### Added

- `testingbot whoami`: shows the account, plan, minutes left and concurrency, and which credentials are in use (options, `TB_KEY`/`TB_SECRET` or `~/.testingbot`).
- `testingbot logout`: deletes `~/.testingbot`, and warns when `TB_KEY`/`TB_SECRET` still apply.
- `testingbot devices`: lists device names and OS versions per framework, or real devices with their availability with `--real` (needs credentials), along with the flags the run commands take to select them.
- `--disable-animations` / `--no-disable-animations` for `testingbot maestro`, sent as `maestroOptions.disableAnimations` only when one of them is given, so `platform.ios/android.disableAnimations` in `config.yaml` (and the device default) still apply otherwise.
- `--debug` for `testingbot espresso`, which logs API responses the way it already did for `xcuitest` and `maestro`.

### Fixed

- Maestro `assertScreenshot` baselines are now uploaded when the path has no extension (`assertScreenshot: screenshots/home`, which Maestro saves as `.png`) and when it uses the `{ path }` form. Before, these runs failed with "Screenshot file not found".
- `includedPaths` globs in Maestro's `config.yaml` are now bundled, which covers baselines whose paths contain variables (`screenshots/${DEVICE}/home.png`) and can't be resolved before the run.
- `--download-artifacts failed` for Maestro now selects failed runs by the same rule as the exit code, so cancelled runs get their artifacts too.
- `testingbot espresso --report html` is now rejected before any upload. The Espresso API only serves JUnit reports, and before this the command exited 0 without writing a file.
- `testingbot login` now checks a random `state` value on the loopback callback, so another local process can't inject credentials or abort the login. An existing `~/.testingbot` is now set to mode `0600`.

## 1.4.2 - 2026-10-25

### Added

- `--secret-env KEY=VALUE` (repeatable) for `testingbot maestro`: passes a variable to the flows like `-e`, but the value is sent as `maestroOptions.secretEnv`, stored encrypted by the API and shown as `***` in the run options, the dashboard and the reports. A key given to both `-e` and `--secret-env` is rejected before any request is made. Values passed with `-e` remain visible in the run options and reports, so use `--secret-env` for credentials.

### Changed

- `--dry-run` and `--debug` never print `--secret-env` values; they appear as `***` in the printed request payload and API responses.

### Dependencies

- follow-redirects 1.16.1, handlebars 4.7.10 (dev).

## 1.4.1 - 2026-10-01

### Fixed

- A Maestro flow that passed (`status: DONE`, `success: 1`) no longer counts as failed just because `error_messages` is non-empty. Maestro's log4j sometimes writes "Unable to write to stream ... maestro.log" to stderr at shutdown, and that turned passing runs into exit code 2. Pass/fail now comes from `status` and `success`, and cancelled flows and runs still fail.

## 1.4.0 - 2026-09-05

### Added

- `--check-name <name>` names the GitHub pull request check `TestingBot / <name>`, so several runs on one commit (an iOS and an Android job) post separate checks that branch protection can require individually. Sent as `checkName` in the run metadata.

## 1.3.0 - 2026-09-04

### Added

- `--app-url <url>` for `testingbot maestro`: download the app under test from an http(s) URL instead of a local file. All formats are supported (`.apk`, `.apks`, `.ipa`, `.zip`, `.tar.gz`); the type is taken from the URL path, then the `Content-Disposition` header, then `Content-Type`. Expired signed links (401/403), such as EAS Build URLs after about an hour, are reported as such.
- `.tar.gz` as an app format, local or downloaded, for Expo / EAS iOS simulator builds. The archive is extracted with the system `tar` and the `.app` bundle inside (root or `Payload/`) is uploaded.
- `testingbot upload <url>` accepts URLs as well as paths.
- Inside an EAS Build job the run is tagged with the EAS build id, profile and platform, and `EAS_BUILD_GIT_COMMIT_HASH` is used as the commit SHA unless `--commit-sha` is given.

### Changed

- Only one app source may be given per run: a file, `--app-url` or `--app-binary-id`.
- Temporary downloads and extractions are removed after the upload, including when the upload fails.

### Dependencies

- @humanfs/node 0.16.8.

## 1.2.0 - 2026-09-02

### Added

- `--json` prints one JSON document on stdout (logs move to stderr); `--json-file` and `--json-file-name` write it to disk while keeping console output. Every flow attempt is listed with `attempt`, `latest`, `passed`, device, timings and errors.
- Exit codes now distinguish test failures (2) from CLI or infrastructure errors (1) for `maestro`, `espresso` and `xcuitest`. With `--json-file` a failed run exits 0 so the file is the contract.
- `testingbot status --id <projectId> [--wait]`, `testingbot artifacts --id <projectId>`, `testingbot list` and `testingbot upload <app>` for working with runs started earlier, typically with `--async`.
- `--app-binary-id <projectId>` reuses an app uploaded earlier without re-uploading it. Every run prints its project ID after the upload.
- `--device-matrix "<device>[:<version>][:real]"` runs every flow on each listed device in one command, each device with its own run, results and retries.
- `--branch`, `--pr-url` and repeatable `-m/--metadata KEY=VALUE` run metadata; `--exclude-flows` to leave files, directories or globs out of the bundle; `--report allure`.
- Alternative spellings for common flags are accepted as hidden aliases (`--app-file`, `--flows`, `--apiKey`, `--device-model`, `--device-os`, `--format`, `--output`, `--test-suite-name`).
- The CLI logs when the server registered a GitHub status check for the run.

### Changed

- JSON output reports the device that actually ran, not a wildcard request.
- `status --wait` detaches on Ctrl-C without cancelling the runs.

### Fixed

- Maestro fails instead of uploading a bundle with no runnable flow.
- Repeatable options no longer leak values between invocations.

### Dependencies

- js-yaml, socket.io-parser and brace-expansion updates; workflow permissions for code scanning.

## 1.1.1 - 2026-07-27

### Changed

- Improved Maestro cancel signal handling.
- Maestro output distinguishes top-level flows from bundled subflows and warns when a flow runs both as top-level and as a subflow.

### Dependencies

- axios 1.18.0, js-yaml 4.3.0 and transitive updates for Dependabot alerts.
