# Changelog

All notable changes to `@testingbot/cli` are documented here. Releases are published to npm from GitHub releases.

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
