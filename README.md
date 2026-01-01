<p align="center">
  <a href="https://testingbot.com">
    <img src="resources/logo.svg" alt="Maestro Cloud Testing" width="400">
  </a>
  <br>
  <strong>Run mobile tests on real devices in the cloud</strong>
</p>

<p align="center">
  <a href="https://github.com/testingbot/testingbotctl/actions/workflows/test.yml">
    <img src="https://github.com/testingbot/testingbotctl/actions/workflows/test.yml/badge.svg" alt="Run Tests">
  </a>
  <a href="https://www.npmjs.com/package/@testingbot/cli">
    <img src="https://img.shields.io/npm/v/@testingbot/cli.svg" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/@testingbot/cli">
    <img src="https://img.shields.io/npm/dm/@testingbot/cli.svg" alt="npm downloads">
  </a>
  <a href="https://github.com/testingbot/testingbotctl/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/@testingbot/cli.svg" alt="license">
  </a>
</p>

<p align="center">
  <a href="https://testingbot.com">Website</a>
  ·
  <a href="https://testingbot.com/support/app-automate/maestro">Documentation</a>
  ·
  <a href="https://www.npmjs.com/package/@testingbot/cli">npm</a>
</p>

---

<table>
<tr>
<td width="50%" valign="top">

**Run Espresso, XCUITest and Maestro tests on TestingBot's cloud infrastructure.**

- **Real Devices** — Test on thousands of real iOS and Android devices
- **Emulators & Simulators** — Fast feedback with virtual devices
- **Parallel Execution** — Split tests across multiple devices
- **CI/CD Ready** — Integrates with GitHub Actions, Jenkins, and more
- **Live Results** — Watch tests run in real-time
- **Artifacts** — Download videos, screenshots, and logs

</td>
<td width="50%">

<video src="https://github.com/testingbot/testingbotctl/raw/main/demo/demo.webm" autoplay loop muted playsinline></video>

</td>
</tr>
</table>

<p align="center">
  <a href="#installation"><strong>Get Started →</strong></a>
</p>

---

## Installation

```sh
npm install -g @testingbot/cli
```

**Requirements:** NodeJS 20 or higher

## Authentication

The CLI requires TestingBot API credentials. You can authenticate in several ways:

### Browser Login (Recommended)

```sh
testingbot login
```

This opens your browser for authentication. After logging in, your credentials are saved to `~/.testingbot`.

### Other Methods

- **Command-line options**: `--api-key` and `--api-secret`
- **Environment variables**: `TB_KEY` and `TB_SECRET`
- **Config file**: Create `~/.testingbot` with content `key:secret`

## Commands

### Maestro

Run Maestro UI tests on real devices and emulators/simulators.

```sh
testingbot maestro <app> <flows...> [options]
```

**Arguments:**
- `app` - Path to your app file (.apk, .ipa, .app, or .zip)
- `flows` - One or more paths to flow files (.yaml/.yml), directories, .zip files, or glob patterns

**Device Options:**

| Option | Description |
|--------|-------------|
| `--device <name>` | Device name (e.g., "Pixel 9", "iPhone 16") |
| `--platform <name>` | Platform: Android or iOS |
| `--deviceVersion <version>` | OS version (e.g., "14", "17.2") |
| `--real-device` | Use a real device instead of emulator/simulator |
| `--orientation <orientation>` | Screen orientation: PORTRAIT or LANDSCAPE |
| `--device-locale <locale>` | Device locale (e.g., "en_US", "de_DE") |
| `--timezone <timezone>` | Timezone (e.g., "America/New_York", "Europe/London") |

**Test Configuration:**

| Option | Description |
|--------|-------------|
| `--name <name>` | Test name for dashboard identification |
| `--build <build>` | Build identifier for grouping test runs |
| `--include-tags <tags>` | Only run flows with these tags (comma-separated) |
| `--exclude-tags <tags>` | Exclude flows with these tags (comma-separated) |
| `-e, --env <KEY=VALUE>` | Environment variable for flows (can be repeated) |
| `--maestro-version <version>` | Maestro version to use (e.g., "2.0.10") |

**Network & Location:**

| Option | Description |
|--------|-------------|
| `--throttle-network <speed>` | Network throttling: 4G, 3G, Edge, airplane, or disable |
| `--geo-country-code <code>` | Geographic IP location (ISO country code, e.g., "US", "DE") |

**Output Options:**

| Option | Description |
|--------|-------------|
| `--async` | Start tests and exit without waiting for results |
| `-q, --quiet` | Suppress progress output |
| `--report <format>` | Download report after completion: html or junit |
| `--report-output-dir <path>` | Directory to save reports (required with --report) |
| `--download-artifacts [mode]` | Download test artifacts (logs, screenshots, video). Mode: `all` (default) or `failed` |
| `--artifacts-output-dir <path>` | Directory to save artifacts zip (defaults to current directory) |

**Advanced Options:**

| Option | Description |
|--------|-------------|
| `--shard-split <number>` | Split flows into N parallel sessions for faster execution |
| `--ignore-checksum-check` | Skip checksum verification and always upload the app |

**CI/CD Integration:**

| Option | Description |
|--------|-------------|
| `--commit-sha <sha>` | Git commit SHA associated with this test run |
| `--pull-request-id <id>` | Pull request ID this test run originated from |
| `--repo-name <name>` | Repository name (e.g., GitHub repo slug) |
| `--repo-owner <owner>` | Repository owner (e.g., GitHub organization or username) |

**Examples:**

```sh
# Basic usage
testingbot maestro app.apk ./flows

# Multiple flow directories
testingbot maestro app.apk ./flows/smoke ./flows/regression ./flows/e2e

# With device selection
testingbot maestro app.apk ./flows --device "Pixel 8" --deviceVersion "14"

# Android app on real device with tags
testingbot maestro app.apk ./flows --device "Samsung Galaxy S24" --real-device --include-tags "smoke,regression"

# With environment variables
testingbot maestro app.apk ./flows -e API_URL=https://staging.example.com -e API_KEY=secret

# Download JUnit report
testingbot maestro app.apk ./flows --report junit --report-output-dir ./reports

# Download all artifacts (logs, screenshots, video)
testingbot maestro app.apk ./flows --download-artifacts --build "build-123"

# Download artifacts only for failed tests
testingbot maestro app.apk ./flows --download-artifacts failed --artifacts-output-dir ./artifacts

# Run in background (async)
testingbot maestro app.apk ./flows --async

# Split flows across 3 shards, grouping all flows over 3 parallel sessions
testingbot maestro app.apk ./flows --shard-split 3

# CI/CD integration with Git metadata
testingbot maestro app.apk ./flows \
  --commit-sha "abc123def" \
  --pull-request-id "42" \
  --repo-owner "myorg" \
  --repo-name "myapp"
```

---

### Espresso

Run Android Espresso tests on real devices and emulators.

```sh
testingbot espresso [appFile] [testAppFile] [options]
```

**Arguments:**
- `appFile` - Path to application APK file
- `testAppFile` - Path to test APK file containing Espresso tests

**Device Options:**

| Option | Description |
|--------|-------------|
| `--app <path>` | Path to application APK file |
| `--test-app <path>` | Path to test APK file |
| `--device <name>` | Device name (e.g., "Pixel 6", "Samsung.*") |
| `--platform-version <version>` | Android OS version (e.g., "12", "13", "14") |
| `--real-device` | Use a real device instead of an emulator |
| `--tablet-only` | Only allocate tablet devices |
| `--phone-only` | Only allocate phone devices |
| `--locale <locale>` | Device locale (e.g., "en_US", "de_DE") |
| `--timezone <timezone>` | Timezone (e.g., "America/New_York", "Europe/London") |

**Test Configuration:**

| Option | Description |
|--------|-------------|
| `--name <name>` | Test name for dashboard identification |
| `--build <build>` | Build identifier for grouping test runs |
| `--test-runner <runner>` | Custom test instrumentation runner |
| `--language <lang>` | App language (ISO 639-1 code, e.g., "en", "fr", "de") |

**Test Filtering:**

| Option | Description |
|--------|-------------|
| `--class <classes>` | Run tests in specific classes (comma-separated fully qualified names) |
| `--not-class <classes>` | Exclude tests in specific classes |
| `--package <packages>` | Run tests in specific packages (comma-separated) |
| `--not-package <packages>` | Exclude tests in specific packages |
| `--annotation <annotations>` | Run tests with specific annotations (comma-separated) |
| `--not-annotation <annotations>` | Exclude tests with specific annotations |
| `--size <sizes>` | Run tests by size: small, medium, large (comma-separated) |

**Network & Location:**

| Option | Description |
|--------|-------------|
| `--throttle-network <speed>` | Network throttling: 4G, 3G, Edge, or airplane |
| `--geo-location <code>` | Geographic IP location (ISO country code, e.g., "US", "DE") |

**Output Options:**

| Option | Description |
|--------|-------------|
| `--async` | Start tests and exit without waiting for results |
| `-q, --quiet` | Suppress progress output |
| `--report <format>` | Download report after completion: html or junit |
| `--report-output-dir <path>` | Directory to save reports (required with --report) |

**Examples:**

```sh
# Basic usage with positional arguments
testingbot espresso app.apk app-test.apk --device "Pixel 8"

# Using named options
testingbot espresso --app app.apk --test-app app-test.apk --device "Pixel 8"

# Real device with specific Android version
testingbot espresso app.apk app-test.apk \
  --device "Samsung Galaxy S24" \
  --platform-version "14" \
  --real-device

# Run specific test classes
testingbot espresso app.apk app-test.apk \
  --device "Pixel 8" \
  --class "com.example.LoginTest,com.example.HomeTest"

# Run tests with annotations
testingbot espresso app.apk app-test.apk \
  --device "Pixel 8" \
  --annotation "com.example.SmokeTest" \
  --size "small,medium"

# With network throttling and geolocation
testingbot espresso app.apk app-test.apk \
  --device "Pixel 8" \
  --throttle-network "3G" \
  --geo-location "DE" \
  --language "de"

# Download JUnit report
testingbot espresso app.apk app-test.apk \
  --device "Pixel 8" \
  --report junit \
  --report-output-dir ./reports
```

---

### XCUITest

Run iOS XCUITest tests on real devices and simulators.

```sh
testingbot xcuitest [appFile] [testAppFile] [options]
```

**Arguments:**
- `appFile` - Path to application IPA file
- `testAppFile` - Path to test ZIP file containing XCUITests

**Device Options:**

| Option | Description |
|--------|-------------|
| `--app <path>` | Path to application IPA file |
| `--test-app <path>` | Path to test ZIP file |
| `--device <name>` | Device name (e.g., "iPhone 15", "iPad.*") |
| `--platform-version <version>` | iOS version (e.g., "17.0", "18.2") |
| `--real-device` | Use a real device instead of a simulator |
| `--tablet-only` | Only allocate tablet devices |
| `--phone-only` | Only allocate phone devices |
| `--orientation <orientation>` | Screen orientation: PORTRAIT or LANDSCAPE |
| `--locale <locale>` | Device locale (e.g., "DE", "US") |
| `--timezone <timezone>` | Timezone (e.g., "America/New_York", "Europe/London") |

**Test Configuration:**

| Option | Description |
|--------|-------------|
| `--name <name>` | Test name for dashboard identification |
| `--build <build>` | Build identifier for grouping test runs |
| `--language <lang>` | App language (ISO 639-1 code, e.g., "en", "fr", "de") |

**Network & Location:**

| Option | Description |
|--------|-------------|
| `--throttle-network <speed>` | Network throttling: 4G, 3G, Edge, or airplane |
| `--geo-location <code>` | Geographic IP location (ISO country code, e.g., "US", "DE") |

**Output Options:**

| Option | Description |
|--------|-------------|
| `--async` | Start tests and exit without waiting for results |
| `-q, --quiet` | Suppress progress output |
| `--report <format>` | Download report after completion: html or junit |
| `--report-output-dir <path>` | Directory to save reports (required with --report) |

**Examples:**

```sh
# Basic usage with positional arguments
testingbot xcuitest app.ipa app-test.zip --device "iPhone 16"

# Using named options
testingbot xcuitest --app app.ipa --test-app app-test.zip --device "iPhone 16"

# Real device with specific iOS version
testingbot xcuitest app.ipa app-test.zip \
  --device "iPhone 15 Pro" \
  --platform-version "17.2" \
  --real-device

# iPad in landscape mode
testingbot xcuitest app.ipa app-test.zip \
  --device "iPad Pro" \
  --tablet-only \
  --orientation LANDSCAPE

# With localization settings
testingbot xcuitest app.ipa app-test.zip \
  --device "iPhone 16" \
  --locale "DE" \
  --language "de" \
  --timezone "Europe/Berlin"

# With network throttling and geolocation
testingbot xcuitest app.ipa app-test.zip \
  --device "iPhone 16" \
  --throttle-network "3G" \
  --geo-location "DE"

# Download HTML report
testingbot xcuitest app.ipa app-test.zip \
  --device "iPhone 16" \
  --report html \
  --report-output-dir ./reports

# Run in background
testingbot xcuitest app.ipa app-test.zip \
  --device "iPhone 16" \
  --async
```

---

## Common Features

### Real-time Progress

By default, the CLI shows real-time progress updates including:
- Test status updates with actual device names (even when using wildcards)
- Device allocation status
- Live output from Maestro flows

Use `--quiet` to suppress progress output.

### Graceful Shutdown

Press `Ctrl+C` to gracefully stop running tests. The CLI will:
1. Stop all active test runs on TestingBot
2. Clean up resources
3. Exit with appropriate status code

Press `Ctrl+C` twice to force exit immediately.

### Report Downloads

All test frameworks support downloading reports after completion:

```sh
# JUnit XML format (for CI integration)
--report junit --report-output-dir ./reports

# HTML format (for human viewing)
--report html --report-output-dir ./reports
```

### Artifact Downloads (Maestro only)

Download all test artifacts including logs, screenshots, and video recordings:

```sh
testingbot maestro app.apk ./flows --download-artifacts --build "my-build"
```

Artifacts are saved as a zip file named after the `--build` value (or with a timestamp if not provided).

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed or an error occurred

## Documentation

For more information, visit [TestingBot Documentation](https://testingbot.com/support).

## License

MIT
