# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run start        # Run the compiled CLI
npm test             # Run all tests with Jest
npm run lint         # Run Prettier and ESLint
npm run format       # Auto-format code with Prettier
```

Run a single test file:
```bash
npx jest tests/cli.test.ts
```

Run tests matching a pattern:
```bash
npx jest --testNamePattern="espresso"
```

## Architecture

This is a TypeScript CLI tool for running mobile tests (Espresso, XCUITest, Maestro) on TestingBot's cloud infrastructure.

### Core Structure

- `src/index.ts` - Entry point, invokes the CLI parser
- `src/cli.ts` - Command definitions using Commander.js. Defines three commands: `espresso`, `maestro`, `xcuitest`
- `src/auth.ts` - Reads credentials from `~/.testingbot` file (format: `username:accessKey`)
- `src/providers/` - Test framework implementations (Espresso, XCUITest, Maestro). Each provider handles validation, app upload, test app upload, and test execution via TestingBot API
- `src/models/` - Data classes for options and credentials

### Provider Pattern

Each provider (Espresso, XCUITest, Maestro) follows the same pattern:
1. Validate options (check required files exist)
2. Upload main app to TestingBot API
3. Upload test app
4. Trigger test run

API base URLs:
- Espresso: `https://api.testingbot.com/v1/app-automate/espresso`
- XCUITest: `https://api.testingbot.com/v1/app-automate/xcuitest`
- Maestro: `https://api.testingbot.com/v1/app-automate/maestro`

### Testing

Tests use Jest with ts-jest. Provider classes and auth are mocked in CLI tests to test command parsing logic. Provider tests mock axios and fs to test upload/validation logic without network calls.
