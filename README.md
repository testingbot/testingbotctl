[![Run Tests](https://github.com/testingbot/testingbotctl/actions/workflows/test.yml/badge.svg)](https://github.com/testingbot/testingbotctl/actions/workflows/test.yml)

# TestingBot CLI

CLI tool to run Espresso, XCUITest and Maestro tests on [TestingBot's](https://testingbot.com) cloud infrastructure.

## Installation

```sh
npm install -g testingbotctl
```

## Authentication

The CLI requires TestingBot API credentials. You can provide them in three ways:

1. **Command-line options**: `--api-key` and `--api-secret`
2. **Environment variables**: `TB_KEY` and `TB_SECRET`
3. **Config file**: Create `~/.testingbot` with content `key:secret`

## Commands

### Maestro

Run Maestro UI tests on real devices and emulators/simulators.

```sh
testingbot maestro <app> <flows> [options]
```

**Arguments:**
- `app` - Path to your app file (.apk, .ipa, .app, or .zip)
- `flows` - Path to flow file (.yaml/.yml), directory, .zip, or glob pattern

**Options:**

| Option | Description |
|--------|-------------|
| `--device <name>` | Device name (e.g., "Pixel 9", "iPhone 16") |
| `--platform <name>` | Platform: Android or iOS |
| `--deviceVersion <version>` | OS version (e.g., "14", "17.2") |
| `--orientation <orientation>` | PORTRAIT or LANDSCAPE |
| `--device-locale <locale>` | Device locale (e.g., "en_US", "de_DE") |
| `--timezone <timezone>` | Timezone (e.g., "America/New_York") |
| `--name <name>` | Test name for dashboard |
| `--build <build>` | Build identifier for grouping |
| `--throttle-network <speed>` | Network throttling: 4G, 3G, Edge, airplane, disable |
| `--geo-country-code <code>` | Geographic IP location (ISO code) |
| `--include-tags <tags>` | Only run flows with these tags (comma-separated) |
| `--exclude-tags <tags>` | Exclude flows with these tags (comma-separated) |
| `-e, --env <KEY=VALUE>` | Environment variable for flows (repeatable) |
| `--maestro-version <version>` | Maestro version to use |
| `--async` | Start tests and exit without waiting for results |
| `-q, --quiet` | Suppress progress output |
| `--report <format>` | Download report after completion: html or junit |
| `--report-output-dir <path>` | Directory to save reports |

**Examples:**

```sh
# Basic usage
testingbot maestro app.apk ./flows

# With device selection
testingbot maestro app.apk ./flows --device "Pixel 8" --deviceVersion "14"

# iOS app with tags
testingbot maestro app.ipa ./flows --platform iOS --include-tags "smoke,regression"

# With environment variables
testingbot maestro app.apk ./flows -e API_URL=https://staging.example.com -e API_KEY=secret

# Download JUnit report
testingbot maestro app.apk ./flows --report junit --report-output-dir ./reports

# Run in background (async)
testingbot maestro app.apk ./flows --async
```

### Espresso

Run Android Espresso tests on real devices and emulators.

```sh
testingbot espresso [options]
```

**Required Options:**

| Option | Description |
|--------|-------------|
| `--app <path>` | Path to application under test (.apk) |
| `--test-app <path>` | Path to test application (.apk) |
| `--device <name>` | Real device to use |
| `--emulator <name>` | Emulator to use |

**Example:**

```sh
testingbot espresso \
  --app app.apk \
  --test-app app-test.apk \
  --device "Pixel 8" \
  --emulator "Android 14"
```

### XCUITest

Run iOS XCUITest tests on real devices and simulators.

```sh
testingbot xcuitest [options]
```

**Required Options:**

| Option | Description |
|--------|-------------|
| `--app <path>` | Path to application under test (.ipa or .app) |
| `--test-app <path>` | Path to test application |
| `--device <name>` | Device to use |

**Example:**

```sh
testingbot xcuitest \
  --app app.ipa \
  --test-app app-test.zip \
  --device "iPhone 16"
```

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed or an error occurred

## Documentation

For more information, visit [TestingBot Documentation](https://testingbot.com/support).

## License

MIT
