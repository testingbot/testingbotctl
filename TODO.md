# Maestro Implementation Roadmap

Comparison with `@devicecloud.dev/dcd` package to achieve feature parity.

## What We Already Have ✅

| Feature | Status |
|---------|--------|
| Positional args (app, flows) | ✅ |
| Named options (--app, --flows) | ✅ |
| Single flow file support | ✅ |
| Directory of flows | ✅ |
| Glob pattern support | ✅ |
| config.yaml flow patterns | ✅ |
| Dependency discovery (runFlow, runScript, addMedia) | ✅ |
| Include/exclude tags | ✅ |
| Upload progress bar | ✅ |
| Zip compression | ✅ |

---

## Phase 1: Core Polling & Status (High Priority)

Essential for knowing when tests complete and viewing results.

### 1.1 Results Polling Service
- [ ] Create `ResultsPollingService` class
- [ ] Poll API every 5 seconds for test status
- [ ] Continue until all tests reach terminal state (PASSED/FAILED/CANCELLED)
- [ ] Handle API failures with retry logic (max 10 attempts)
- [ ] Display progress: "Running tests... (1/3 passed, 1 running, 1 pending)"

### 1.2 Console URL Output
- [ ] After test submission, display link to results
- [ ] Format: `Results available at: https://testingbot.com/...`

### 1.3 Async Mode (`--async`)
- [ ] Add `--async` flag to CLI
- [ ] Return immediately after submission with upload/run ID
- [ ] Exit code 0 (don't wait for results)
- [ ] Useful for CI/CD pipelines to save build minutes

### 1.4 Status Command
- [ ] Add new `testingbotctl status` command
- [ ] Options: `--id <runId>` to query specific run
- [ ] Display test results with status, duration, fail reasons
- [ ] Can be used after `--async` to check results later

---

## Phase 2: CI/CD Integration (Medium Priority)

Features needed for seamless CI/CD pipeline integration.

### 2.1 JSON Output Mode
- [ ] Add `--json` flag for JSON stdout output
- [ ] Add `--json-file` flag to write JSON to file (preserves console output)
- [ ] Add `--json-file-name <name>` for custom filename
- [ ] Include: test names, status, durations, errors, URLs

### 2.2 Report Generation
- [ ] Add `--report <format>` option
- [ ] Support formats: `junit`, `html`, `allure`
- [ ] Add `--junit-path <path>` for JUnit output location
- [ ] Add `--html-path <path>` for HTML output location
- [ ] Generate reports after test completion

### 2.3 Artifact Download
- [ ] Add `--download-artifacts <mode>` option
- [ ] Modes: `ALL` (all tests), `FAILED` (only failed tests)
- [ ] Add `--artifacts-path <path>` for download location
- [ ] Download: screenshots, videos, logs

### 2.4 Dry-Run Mode
- [ ] Add `--dry-run` flag
- [ ] Validate configuration without executing tests
- [ ] List all flows that would be executed
- [ ] Check file existence and dependencies
- [ ] No API calls or charges

---

## Phase 3: Advanced Configuration (Medium Priority)

Enhanced device and execution configuration.

### 3.1 Device Configuration Options
- [ ] `--android-api-level <level>` - Specific Android API (e.g., 34, 35)
- [ ] `--ios-version <version>` - Specific iOS version
- [ ] `--device-locale <code>` - Device locale (e.g., de_DE, en_US)
- [ ] `--orientation <degrees>` - Screen orientation (0 or 90)

### 3.2 App Binary Reuse
- [ ] Add `--app-binary-id <id>` option
- [ ] Skip upload if binary already exists on server
- [ ] Implement SHA hash checking for deduplication
- [ ] Add `--ignore-sha-check` to bypass deduplication

### 3.3 Environment Variables
- [ ] Add `--env <KEY=VALUE>` option (repeatable)
- [ ] Pass environment variables to test execution
- [ ] Support `TESTINGBOT_OVERRIDE_*` pattern in flow configs

### 3.4 Retry Support
- [ ] Add `--retry <count>` option
- [ ] Auto-retry failed tests (max 2-3 retries)
- [ ] Track retry attempts in results
- [ ] Only report final attempt status

### 3.5 Test Run Naming
- [ ] Add `--name <name>` option
- [ ] Custom name for test runs in dashboard
- [ ] Default to timestamp or flow directory name

---

## Phase 4: Polish & Advanced Features (Lower Priority)

Nice-to-have improvements for better UX.

### 4.1 Better Progress Display
- [ ] Show table with test names, status, durations
- [ ] Color-coded status (green=passed, red=failed, yellow=running)
- [ ] Update in place (clear and redraw)
- [ ] Show fail reasons inline

### 4.2 Sequential Execution Support
- [ ] Support `executionOrder` in config.yaml
- [ ] `flowsOrder` array for specific sequence
- [ ] `continueOnFailure` flag
- [ ] Flows not in order run in parallel first

### 4.3 Flow Discovery Improvements
- [ ] Exclude files inside `.app` bundles (iOS app directories)
- [ ] Better error messages for missing dependencies
- [ ] Warn about unused files in flows directory

### 4.4 Quiet Mode
- [ ] Add `-q, --quiet` flag
- [ ] Minimal console output
- [ ] Only show errors and final result

### 4.5 Debug Mode
- [ ] Add `--debug` flag
- [ ] Detailed logging of all operations
- [ ] Show API requests/responses (excluding sensitive data)

---

## API Endpoints Needed

Document any new API endpoints required from TestingBot:

1. **GET /maestro/:id/status** - Poll for test run status
2. **GET /maestro/:id/results** - Get detailed test results
3. **GET /maestro/:id/artifacts** - Download test artifacts
4. **GET /maestro/binaries/:sha** - Check if binary already uploaded

---

## Notes

- Reference implementation: `/Users/jochen/test/node_modules/@devicecloud.dev/dcd`
- dcd uses oclif framework, we use commander.js
- dcd polls every 5 seconds (`POLL_INTERVAL_MS = 5000`)
- dcd supports up to 10 API failure retries during polling
