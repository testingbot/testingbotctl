import { Command, InvalidArgumentError } from 'commander';
import logger, { enableDebugLogging } from './logger';
import Auth from './auth';
import Espresso from './providers/espresso';
import EspressoOptions, {
  TestSize,
  ReportFormat as EspressoReportFormat,
  ThrottleNetwork as EspressoThrottleNetwork,
} from './models/espresso_options';
import XCUITestOptions, {
  Orientation as XCUITestOrientation,
  ThrottleNetwork as XCUITestThrottleNetwork,
  ReportFormat as XCUITestReportFormat,
} from './models/xcuitest_options';
import XCUITest from './providers/xcuitest';
import packageJson from '../package.json';
import MaestroOptions, {
  Orientation,
  ThrottleNetwork,
  ReportFormat,
  ArtifactDownloadMode,
} from './models/maestro_options';
import Maestro from './providers/maestro';
import Login from './providers/login';
import Credentials from './models/credentials';
import TestingBotError from './models/testingbot_error';
import { redirectLogsToStderr } from './logger';
import {
  EXIT_ERROR,
  JsonOutput,
  JsonOutputOptions,
  resolveExitCode,
  validateJsonOptions,
  writeJsonOutput,
} from './utils/json_output';

interface JsonCliArgs {
  json?: boolean;
  jsonFile?: boolean;
  jsonFileName?: string;
}

/**
 * Normalizes the --json* flags, validates their combination and, for --json,
 * moves logging to stderr before any output is produced.
 */
function jsonOptionsFrom(args: JsonCliArgs): JsonOutputOptions {
  const options: JsonOutputOptions = {
    json: Boolean(args.json),
    jsonFile: Boolean(args.jsonFile),
    jsonFileName: args.jsonFileName,
  };
  validateJsonOptions(options);
  if (options.json) {
    redirectLogsToStderr();
  }
  return options;
}

/** Resolves credentials from flags, env or ~/.testingbot, or fails with guidance. */
async function requireCredentials(args: {
  apiKey?: string;
  apiSecret?: string;
}): Promise<Credentials> {
  const credentials = await Auth.getCredentials({
    apiKey: args.apiKey,
    apiSecret: args.apiSecret,
  });
  if (credentials === null) {
    throw new TestingBotError(
      'No TestingBot credentials found. Please authenticate using one of these methods:\n' +
        '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
        '  2. Use --api-key and --api-secret options\n' +
        '  3. Set TB_KEY and TB_SECRET environment variables\n' +
        '  4. Create ~/.testingbot file with content: key:secret',
    );
  }
  return credentials;
}

function parseProjectId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new InvalidArgumentError(
      `expected a positive integer (the "Project ID" printed when a run starts), got "${value}".`,
    );
  }
  return id;
}

/** Emits JSON output (if requested) and sets the exit code for a finished run. */
async function finishCommand(
  output: JsonOutput,
  jsonOptions: JsonOutputOptions,
): Promise<void> {
  const written = await writeJsonOutput(output, jsonOptions);
  if (written && !jsonOptions.json) {
    logger.info(`JSON results written to ${written}`);
  }
  process.exitCode = resolveExitCode(output, jsonOptions);
}

/**
 * Reports a CLI/infrastructure error: logs it, exits 1, and still emits a JSON
 * document when requested so a consumer never has to parse missing output.
 */
async function failCommand(
  provider: JsonOutput['provider'],
  label: string,
  err: unknown,
  jsonOptions: JsonOutputOptions | undefined,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`${label} error: ${message}`);
  process.exitCode = EXIT_ERROR;
  if (!jsonOptions || (!jsonOptions.json && !jsonOptions.jsonFile)) return;
  try {
    await writeJsonOutput(
      { provider, outcome: 'error', success: false, error: message, runs: [] },
      jsonOptions,
    );
  } catch (writeError) {
    logger.error(
      writeError instanceof Error ? writeError.message : String(writeError),
    );
  }
}

const program = new Command();

program
  .name('testingbot')
  .version(packageJson.version, '-v, --version', 'Show version number')
  .description(
    'CLI tool to run Espresso, XCUITest and Maestro tests on TestingBot cloud',
  );

program
  .command('espresso')
  .description('Run Espresso tests on TestingBot.')
  .argument('[appFile]', 'Path to application APK file')
  .argument('[testAppFile]', 'Path to test APK file containing Espresso tests')
  // App and test options
  .option('--app <path>', 'Path to application APK file.')
  .option(
    '--test-app <path>',
    'Path to test APK file containing Espresso tests.',
  )
  // Device configuration
  .option(
    '--device <device>',
    'Device name to use for testing (e.g., "Pixel 6", "Samsung.*").',
  )
  .option(
    '--platform-version <version>',
    'Android OS version (e.g., "12", "13").',
  )
  .option('--real-device', 'Use a real device instead of an emulator.')
  .option('--tablet-only', 'Only allocate tablet devices.')
  .option('--phone-only', 'Only allocate phone devices.')
  .option('--locale <locale>', 'Device locale (e.g., "en_US", "de_DE").')
  .option(
    '--timezone <timezone>',
    'Device timezone (e.g., "America/New_York", "Europe/London").',
  )
  // Test metadata
  .option('--name <name>', 'Test name for identification in dashboard.')
  .option('--build <build>', 'Build identifier for grouping test runs.')
  // Espresso-specific options
  .option(
    '--test-runner <runner>',
    'Custom test instrumentation runner (e.g., "${packageName}/customTestRunner").',
  )
  .option(
    '--class <classes>',
    'Run tests in specific classes (comma-separated fully qualified names).',
    (val) => val.split(',').map((c) => c.trim()),
  )
  .option(
    '--not-class <classes>',
    'Exclude tests in specific classes (comma-separated fully qualified names).',
    (val) => val.split(',').map((c) => c.trim()),
  )
  .option(
    '--package <packages>',
    'Run tests in specific packages (comma-separated).',
    (val) => val.split(',').map((p) => p.trim()),
  )
  .option(
    '--not-package <packages>',
    'Exclude tests in specific packages (comma-separated).',
    (val) => val.split(',').map((p) => p.trim()),
  )
  .option(
    '--annotation <annotations>',
    'Run tests with specific annotations (comma-separated).',
    (val) => val.split(',').map((a) => a.trim()),
  )
  .option(
    '--not-annotation <annotations>',
    'Exclude tests with specific annotations (comma-separated).',
    (val) => val.split(',').map((a) => a.trim()),
  )
  .option(
    '--size <sizes>',
    'Run tests by size: small, medium, large (comma-separated).',
    (val) => val.split(',').map((s) => s.trim().toLowerCase() as TestSize),
  )
  // Localization
  .option(
    '--language <lang>',
    'App language (ISO 639-1 code, e.g., "en", "fr", "de").',
  )
  // Geolocation
  .option(
    '--geo-country-code <code>',
    'Geographic IP location (ISO country code, e.g., "US", "DE").',
  )
  // Network throttling
  .option(
    '--throttle-network <speed>',
    'Network throttling: 4G, 3G, Edge, or airplane.',
    (val) => val as EspressoThrottleNetwork,
  )
  // Execution mode
  .option('-q, --quiet', 'Quieter console output without progress updates.')
  .option(
    '--async',
    'Start tests and exit immediately without waiting for results.',
  )
  .option(
    '--dry-run',
    'Validate and prepare everything but skip HTTP calls. Shows what would be sent.',
  )
  // Tunnel
  .option('-t, --tunnel', 'Start a TestingBot tunnel for this test run.')
  .option(
    '--tunnel-identifier <id>',
    'Identifier for the tunnel (allows multiple tunnels).',
  )
  // Report options
  .option(
    '--report <format>',
    'Download test report after completion: html or junit.',
    (val) => val.toLowerCase() as EspressoReportFormat,
  )
  .option(
    '--report-output-dir <path>',
    'Directory to save test reports (required when --report is used).',
  )
  // CI/CD metadata
  .option('--commit-sha <sha>', 'The commit SHA of this upload.')
  .option(
    '--pull-request-id <id>',
    'The ID of the pull request this upload originated from.',
  )
  .option('--repo-name <name>', 'Repository name (e.g., GitHub repo slug).')
  .option(
    '--repo-owner <owner>',
    'Repository owner (e.g., GitHub organization or user slug).',
  )
  // Authentication
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  // Machine-readable output
  .option(
    '--json',
    'Print results as JSON on stdout; logs move to stderr. Exits 2 when tests fail, 1 on CLI errors.',
  )
  .option(
    '--json-file',
    'Write results as JSON to a file (default: <appId>_testingbot.json). Exits 0 even when tests fail, 1 on CLI errors.',
  )
  .option(
    '--json-file-name <path>',
    'Custom path for the JSON results file (requires --json-file).',
  )
  .action(async (appFileArg, testAppFileArg, args) => {
    let jsonOptions: JsonOutputOptions | undefined;
    try {
      jsonOptions = jsonOptionsFrom(args);
      // Positional arguments take precedence, fall back to options
      const app = appFileArg || args.app;
      const testApp = testAppFileArg || args.testApp;

      const missing: string[] = [];
      if (!app) missing.push('<appFile> or --app');
      if (!testApp) missing.push('<testAppFile> or --test-app');
      if (missing.length > 0) {
        throw new TestingBotError(
          `Missing required argument: ${missing.join(', ')}. Run "testingbot espresso --help" for usage.`,
        );
      }

      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new TestingBotError(
          'No TestingBot credentials found. Please authenticate using one of these methods:\n' +
            '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
            '  2. Use --api-key and --api-secret options\n' +
            '  3. Set TB_KEY and TB_SECRET environment variables\n' +
            '  4. Create ~/.testingbot file with content: key:secret',
        );
      }

      const metadata =
        args.commitSha || args.pullRequestId || args.repoName || args.repoOwner
          ? {
              commitSha: args.commitSha,
              pullRequestId: args.pullRequestId,
              repoName: args.repoName,
              repoOwner: args.repoOwner,
            }
          : undefined;

      const options = new EspressoOptions(app, testApp, args.device, {
        version: args.platformVersion,
        realDevice: args.realDevice,
        tabletOnly: args.tabletOnly,
        phoneOnly: args.phoneOnly,
        name: args.name,
        build: args.build,
        testRunner: args.testRunner,
        class: args.class,
        notClass: args.notClass,
        package: args.package,
        notPackage: args.notPackage,
        annotation: args.annotation,
        notAnnotation: args.notAnnotation,
        size: args.size,
        language: args.language,
        locale: args.locale,
        timeZone: args.timezone,
        geoCountryCode: args.geoCountryCode,
        throttleNetwork: args.throttleNetwork,
        tunnel: args.tunnel,
        tunnelIdentifier: args.tunnelIdentifier,
        quiet: args.quiet || jsonOptions.json || jsonOptions.jsonFile,
        async: args.async,
        dryRun: args.dryRun,
        report: args.report,
        reportOutputDir: args.reportOutputDir,
        metadata,
      });
      const espresso = new Espresso(credentials, options);
      const result = await espresso.run();
      await finishCommand(espresso.toJsonOutput(result), jsonOptions);
    } catch (err) {
      await failCommand('espresso', 'Espresso', err, jsonOptions);
    }
  })
  .showHelpAfterError(true);

program
  .command('maestro')
  .description('Run Maestro flows on TestingBot.')
  .argument(
    '[appFile]',
    'Path to application under test (.apk, .ipa, .app or .zip)',
  )
  .argument(
    '[flows...]',
    'Paths to flow files, directories, or glob patterns (can specify multiple)',
  )
  // App and flows options
  .option(
    '--app <path>',
    'Path to application under test (.apk, .ipa, .app, or .zip).',
  )
  .option(
    '--other-app <path>',
    'Additional app to install alongside --app (.apk, .ipa, .app, or .zip). Repeatable, max 4.',
    (val: string, acc: string[]) => {
      acc.push(val);
      return acc;
    },
    [] as string[],
  )
  // Device configuration
  .option(
    '--device <device>',
    'Device name to use for testing (e.g., "Pixel 9", "iPhone 17").',
  )
  .option(
    '--platform <platform>',
    'Platform name: Android or iOS.',
    (val) => val as 'Android' | 'iOS',
  )
  .option('--deviceVersion <version>', 'OS version (e.g., "14", "17.2").')
  .option(
    '--real-device',
    'Use a real device instead of an emulator/simulator.',
  )
  .option(
    '--google-play',
    'Use the Google Play Store-enabled version (Android emulator only).',
  )
  .option(
    '--orientation <orientation>',
    'Screen orientation: PORTRAIT or LANDSCAPE.',
    (val) => val.toUpperCase() as Orientation,
  )
  .option('--device-locale <locale>', 'Device locale (e.g., "en_US", "de_DE").')
  .option(
    '--timezone <timezone>',
    'Device timezone (e.g., "America/New_York", "Europe/London").',
  )
  // Test metadata
  .option('--name <name>', 'Name for this Maestro run.')
  .option(
    '--groups <names>',
    'Tag the test session with one or more groups (comma-separated).',
    (val) =>
      val
        .split(',')
        .map((g) => g.trim())
        .filter((g) => g.length > 0),
  )
  // Network and geo
  .option(
    '--throttle-network <speed>',
    'Network throttling: 4G, 3G, Edge, airplane, or disable.',
    (val) => val as ThrottleNetwork,
  )
  .option(
    '--geo-country-code <code>',
    'Geographic IP location (ISO country code, e.g., "US", "DE").',
  )
  // Flow filtering
  .option(
    '--include-tags <tags>',
    'Only run flows with these tags (comma-separated).',
    (val) => val.split(',').map((t) => t.trim()),
  )
  .option(
    '--exclude-tags <tags>',
    'Exclude flows with these tags (comma-separated).',
    (val) => val.split(',').map((t) => t.trim()),
  )
  // Environment variables
  .option(
    '-e, --env <KEY=VALUE>',
    'Environment variable to pass to Maestro flows (can be used multiple times).',
    (val: string, acc: string[]) => {
      acc.push(val);
      return acc;
    },
    [] as string[],
  )
  // Maestro configuration
  .option(
    '--config <path>',
    'Path to a custom Maestro config file (default: config.yaml in project root).',
  )
  .option(
    '--maestro-version <version>',
    'Maestro version to use (e.g., "2.0.10").',
  )
  // Execution mode
  .option('-q, --quiet', 'Quieter console output without progress updates.')
  .option(
    '--retry <count>',
    'Retry failed flows up to N times (0-2, default 0). Stops as soon as a flow passes.',
    (val) => parseInt(val, 10),
    0,
  )
  .option(
    '--async',
    'Start tests and exit immediately without waiting for results.',
  )
  .option(
    '--dry-run',
    'Validate and prepare everything but skip HTTP calls. Shows what would be sent.',
  )
  // Tunnel
  .option('-t, --tunnel', 'Start a TestingBot tunnel for this test run.')
  .option(
    '--tunnel-identifier <id>',
    'Identifier for the tunnel (allows multiple tunnels).',
  )
  // Report options
  .option(
    '--report <format>',
    'Download test report after completion: html, html-detailed, or junit.',
    (val) => val.toLowerCase() as ReportFormat,
  )
  .option(
    '--report-output-dir <path>',
    'Directory to save test reports (required when --report is used).',
  )
  // Artifact download
  .option(
    '--download-artifacts [mode]',
    'Download test artifacts after completion. Mode: all (default) or failed.',
    (val) => (val === 'failed' ? 'failed' : 'all') as ArtifactDownloadMode,
  )
  .option(
    '--artifacts-output-dir <path>',
    'Directory to save artifacts zip (defaults to current directory).',
  )
  .option(
    '--ignore-checksum-check',
    'Skip checksum verification and always upload the app.',
  )
  .option(
    '--shard-split <number>',
    'Number of chunks to split flows into (by default each flow runs on its own session).',
    (val) => parseInt(val, 10),
  )
  // CI/CD metadata
  .option('--commit-sha <sha>', 'The commit SHA of this upload.')
  .option(
    '--pull-request-id <id>',
    'The ID of the pull request this upload originated from.',
  )
  .option('--repo-name <name>', 'Repository name (e.g., GitHub repo slug).')
  .option(
    '--repo-owner <owner>',
    'Repository owner (e.g., GitHub organization or user slug).',
  )
  // Authentication
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .option('--debug', 'Enable debug logging of API responses.')
  // Machine-readable output
  .option(
    '--json',
    'Print results as JSON on stdout; logs move to stderr. Exits 2 when tests fail, 1 on CLI errors.',
  )
  .option(
    '--json-file',
    'Write results as JSON to a file (default: <appId>_testingbot.json). Exits 0 even when tests fail, 1 on CLI errors.',
  )
  .option(
    '--json-file-name <path>',
    'Custom path for the JSON results file (requires --json-file).',
  )
  .action(async (appFileArg, flowsArgs, args) => {
    let jsonOptions: JsonOutputOptions | undefined;
    try {
      jsonOptions = jsonOptionsFrom(args);
      let app: string;
      let flows: string[];

      if (args.app) {
        // If --app is specified, treat all positional arguments as flows
        app = args.app;
        flows = appFileArg
          ? [appFileArg, ...(flowsArgs || [])]
          : flowsArgs || [];
      } else {
        // Otherwise, first positional is app, rest are flows
        app = appFileArg;
        flows = flowsArgs || [];
      }

      const missing: string[] = [];
      if (!app) missing.push('<appFile> or --app');
      if (flows.length === 0)
        missing.push(
          '<flows...> (one or more flow files, directories, or globs)',
        );
      if (missing.length > 0) {
        throw new TestingBotError(
          `Missing required argument: ${missing.join(', ')}. Run "testingbot maestro --help" for usage.`,
        );
      }

      const otherApps: string[] = Array.isArray(args.otherApp)
        ? args.otherApp.slice()
        : [];
      // Commander stores the accumulator on a shared default array; reset it so
      // values do not leak across repeated parses (e.g. in tests).
      if (Array.isArray(args.otherApp)) args.otherApp.length = 0;
      if (otherApps.length > 4) {
        throw new TestingBotError(
          `Too many --other-app entries (${otherApps.length}). Maximum is 4.`,
        );
      }

      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new TestingBotError(
          'No TestingBot credentials found. Please authenticate using one of these methods:\n' +
            '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
            '  2. Use --api-key and --api-secret options\n' +
            '  3. Set TB_KEY and TB_SECRET environment variables\n' +
            '  4. Create ~/.testingbot file with content: key:secret',
        );
      }

      // Parse environment variables from -e KEY=VALUE format
      const env: Record<string, string> = {};
      for (const envVar of args.env || []) {
        const eqIndex = envVar.indexOf('=');
        if (eqIndex > 0) {
          const key = envVar.substring(0, eqIndex);
          const value = envVar.substring(eqIndex + 1);
          env[key] = value;
        }
      }

      const metadata =
        args.commitSha || args.pullRequestId || args.repoName || args.repoOwner
          ? {
              commitSha: args.commitSha,
              pullRequestId: args.pullRequestId,
              repoName: args.repoName,
              repoOwner: args.repoOwner,
            }
          : undefined;

      const options = new MaestroOptions(app, flows, args.device, {
        includeTags: args.includeTags,
        excludeTags: args.excludeTags,
        platformName: args.platform,
        version: args.deviceVersion,
        name: args.name,
        orientation: args.orientation,
        locale: args.deviceLocale,
        timeZone: args.timezone,
        throttleNetwork: args.throttleNetwork,
        geoCountryCode: args.geoCountryCode,
        env: Object.keys(env).length > 0 ? env : undefined,
        maestroVersion: args.maestroVersion,
        tunnel: args.tunnel,
        tunnelIdentifier: args.tunnelIdentifier,
        quiet: args.quiet || jsonOptions.json || jsonOptions.jsonFile,
        async: args.async,
        dryRun: args.dryRun,
        report: args.report,
        reportOutputDir: args.reportOutputDir,
        realDevice: args.realDevice,
        downloadArtifacts:
          args.downloadArtifacts === true
            ? 'all'
            : (args.downloadArtifacts as ArtifactDownloadMode | undefined),
        artifactsOutputDir: args.artifactsOutputDir,
        ignoreChecksumCheck: args.ignoreChecksumCheck,
        shardSplit: args.shardSplit,
        retry: args.retry,
        debug: args.debug,
        googlePlayStore: args.googlePlay,
        configFile: args.config,
        groups: args.groups,
        metadata,
        otherApps,
      });
      if (args.debug) {
        enableDebugLogging();
      }
      const maestro = new Maestro(credentials, options);
      const result = await maestro.run();
      await finishCommand(maestro.toJsonOutput(result), jsonOptions);
    } catch (err) {
      await failCommand('maestro', 'Maestro', err, jsonOptions);
    }
  })
  .showHelpAfterError(true);

program
  .command('xcuitest')
  .description('Run XCUITest tests on TestingBot.')
  .argument('[appFile]', 'Path to application IPA file')
  .argument('[testAppFile]', 'Path to test ZIP file containing XCUITests')
  // App and test options
  .option('--app <path>', 'Path to application IPA file.')
  .option('--test-app <path>', 'Path to test ZIP file containing XCUITests.')
  // Device configuration
  .option(
    '--device <device>',
    'Device name to use for testing (e.g., "iPhone 15", "iPad.*").',
  )
  .option('--platform-version <version>', 'iOS version (e.g., "17.0", "18.2").')
  .option('--real-device', 'Use a real device instead of a simulator.')
  .option('--tablet-only', 'Only allocate tablet devices.')
  .option('--phone-only', 'Only allocate phone devices.')
  .option(
    '--orientation <orientation>',
    'Screen orientation: PORTRAIT or LANDSCAPE.',
    (val) => val.toUpperCase() as XCUITestOrientation,
  )
  .option('--locale <locale>', 'Device locale (e.g., "DE", "US").')
  .option(
    '--timezone <timezone>',
    'Device timezone (e.g., "New_York", "Europe/London").',
  )
  // Test metadata
  .option('--name <name>', 'Test name for identification in dashboard.')
  .option('--build <build>', 'Build identifier for grouping test runs.')
  // Localization
  .option(
    '--language <lang>',
    'App language (ISO 639-1 code, e.g., "en", "fr", "de").',
  )
  // Geolocation
  .option(
    '--geo-country-code <code>',
    'Geographic IP location (ISO country code, e.g., "US", "DE").',
  )
  // Network throttling
  .option(
    '--throttle-network <speed>',
    'Network throttling: 4G, 3G, Edge, or airplane.',
    (val) => val as XCUITestThrottleNetwork,
  )
  // Execution mode
  .option('-q, --quiet', 'Quieter console output without progress updates.')
  .option(
    '--async',
    'Start tests and exit immediately without waiting for results.',
  )
  .option(
    '--dry-run',
    'Validate and prepare everything but skip HTTP calls. Shows what would be sent.',
  )
  // Tunnel
  .option('-t, --tunnel', 'Start a TestingBot tunnel for this test run.')
  .option(
    '--tunnel-identifier <id>',
    'Identifier for the tunnel (allows multiple tunnels).',
  )
  // Report options
  .option(
    '--report <format>',
    'Download test report after completion: html or junit.',
    (val) => val.toLowerCase() as XCUITestReportFormat,
  )
  .option(
    '--report-output-dir <path>',
    'Directory to save test reports (required when --report is used).',
  )
  // CI/CD metadata
  .option('--commit-sha <sha>', 'The commit SHA of this upload.')
  .option(
    '--pull-request-id <id>',
    'The ID of the pull request this upload originated from.',
  )
  .option('--repo-name <name>', 'Repository name (e.g., GitHub repo slug).')
  .option(
    '--repo-owner <owner>',
    'Repository owner (e.g., GitHub organization or user slug).',
  )
  // Authentication
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .option('--debug', 'Enable debug logging of API responses.')
  // Machine-readable output
  .option(
    '--json',
    'Print results as JSON on stdout; logs move to stderr. Exits 2 when tests fail, 1 on CLI errors.',
  )
  .option(
    '--json-file',
    'Write results as JSON to a file (default: <appId>_testingbot.json). Exits 0 even when tests fail, 1 on CLI errors.',
  )
  .option(
    '--json-file-name <path>',
    'Custom path for the JSON results file (requires --json-file).',
  )
  .action(async (appFileArg, testAppFileArg, args) => {
    let jsonOptions: JsonOutputOptions | undefined;
    try {
      jsonOptions = jsonOptionsFrom(args);
      // Positional arguments take precedence, fall back to options
      const app = appFileArg || args.app;
      const testApp = testAppFileArg || args.testApp;

      const missing: string[] = [];
      if (!app) missing.push('<appFile> or --app');
      if (!testApp) missing.push('<testAppFile> or --test-app');
      if (missing.length > 0) {
        throw new TestingBotError(
          `Missing required argument: ${missing.join(', ')}. Run "testingbot xcuitest --help" for usage.`,
        );
      }

      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new TestingBotError(
          'No TestingBot credentials found. Please authenticate using one of these methods:\n' +
            '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
            '  2. Use --api-key and --api-secret options\n' +
            '  3. Set TB_KEY and TB_SECRET environment variables\n' +
            '  4. Create ~/.testingbot file with content: key:secret',
        );
      }

      const metadata =
        args.commitSha || args.pullRequestId || args.repoName || args.repoOwner
          ? {
              commitSha: args.commitSha,
              pullRequestId: args.pullRequestId,
              repoName: args.repoName,
              repoOwner: args.repoOwner,
            }
          : undefined;

      const options = new XCUITestOptions(app, testApp, args.device, {
        version: args.platformVersion,
        realDevice: args.realDevice,
        tabletOnly: args.tabletOnly,
        phoneOnly: args.phoneOnly,
        name: args.name,
        build: args.build,
        orientation: args.orientation,
        language: args.language,
        locale: args.locale,
        timeZone: args.timezone,
        geoCountryCode: args.geoCountryCode,
        throttleNetwork: args.throttleNetwork,
        tunnel: args.tunnel,
        tunnelIdentifier: args.tunnelIdentifier,
        quiet: args.quiet || jsonOptions.json || jsonOptions.jsonFile,
        async: args.async,
        dryRun: args.dryRun,
        report: args.report,
        reportOutputDir: args.reportOutputDir,
        debug: args.debug,
        metadata,
      });
      if (args.debug) {
        enableDebugLogging();
      }
      const xcuitest = new XCUITest(credentials, options);
      const result = await xcuitest.run();
      await finishCommand(xcuitest.toJsonOutput(result), jsonOptions);
    } catch (err) {
      await failCommand('xcuitest', 'XCUITest', err, jsonOptions);
    }
  })
  .showHelpAfterError(true);

const JSON_FLAGS = [
  ['--json', 'Print results as JSON on stdout; logs move to stderr.'],
  [
    '--json-file',
    'Write results as JSON to a file (default: <appId>_testingbot.json).',
  ],
  [
    '--json-file-name <path>',
    'Custom path for the JSON results file (requires --json-file).',
  ],
] as const;

const AUTH_FLAGS = [
  ['--api-key <key>', 'TestingBot API key.'],
  ['--api-secret <secret>', 'TestingBot API secret.'],
  ['--debug', 'Enable debug logging of API responses.'],
] as const;

function withFlags(
  command: Command,
  flags: ReadonlyArray<readonly [string, string]>,
): Command {
  for (const [flag, description] of flags) {
    command.option(flag, description);
  }
  return command;
}

withFlags(
  withFlags(
    program
      .command('status')
      .description(
        'Show the current state of a Maestro project started earlier (e.g. with --async).',
      )
      .requiredOption(
        '--id <projectId>',
        'Project ID printed when the run started.',
        parseProjectId,
      )
      .option(
        '-w, --wait',
        'Block until every run has finished, showing live progress. Exits 2 if any flow failed.',
      )
      .option(
        '-q, --quiet',
        'Quieter console output without progress updates.',
      ),
    JSON_FLAGS,
  ),
  AUTH_FLAGS,
)
  .action(async (args) => {
    let jsonOptions: JsonOutputOptions | undefined;
    try {
      jsonOptions = jsonOptionsFrom(args);
      const credentials = await requireCredentials(args);
      if (args.debug) enableDebugLogging();
      const maestro = new Maestro(
        credentials,
        MaestroOptions.forExistingProject({
          quiet: args.quiet || jsonOptions.json || jsonOptions.jsonFile,
          debug: args.debug,
        }),
      );
      const result = await maestro.status(args.id, { wait: args.wait });
      await finishCommand(maestro.toJsonOutput(result), jsonOptions);
    } catch (err) {
      await failCommand('maestro', 'Status', err, jsonOptions);
    }
  })
  .showHelpAfterError(true);

withFlags(
  withFlags(
    program
      .command('artifacts')
      .description(
        'Download reports and/or artifacts (logs, screenshots, video) for a finished Maestro project.',
      )
      .requiredOption(
        '--id <projectId>',
        'Project ID printed when the run started.',
        parseProjectId,
      )
      .option(
        '--report <format>',
        'Download test report: html, html-detailed, or junit.',
        (val) => val.toLowerCase() as ReportFormat,
      )
      .option(
        '--report-output-dir <path>',
        'Directory to save test reports (required when --report is used).',
      )
      .option(
        '--download-artifacts [mode]',
        'Download test artifacts. Mode: all (default) or failed.',
        (val) => (val === 'failed' ? 'failed' : 'all') as ArtifactDownloadMode,
      )
      .option(
        '--artifacts-output-dir <path>',
        'Directory to save artifacts zip (defaults to current directory).',
      )
      .option(
        '-q, --quiet',
        'Quieter console output without progress updates.',
      ),
    JSON_FLAGS,
  ),
  AUTH_FLAGS,
)
  .action(async (args) => {
    let jsonOptions: JsonOutputOptions | undefined;
    try {
      jsonOptions = jsonOptionsFrom(args);
      const credentials = await requireCredentials(args);
      if (args.debug) enableDebugLogging();
      const maestro = new Maestro(
        credentials,
        MaestroOptions.forExistingProject({
          quiet: args.quiet || jsonOptions.json || jsonOptions.jsonFile,
          report: args.report,
          reportOutputDir: args.reportOutputDir,
          downloadArtifacts:
            args.downloadArtifacts === true
              ? 'all'
              : (args.downloadArtifacts as ArtifactDownloadMode | undefined),
          artifactsOutputDir: args.artifactsOutputDir,
          debug: args.debug,
        }),
      );
      const result = await maestro.artifacts(args.id);
      await finishCommand(maestro.toJsonOutput(result), jsonOptions);
    } catch (err) {
      await failCommand('maestro', 'Artifacts', err, jsonOptions);
    }
  })
  .showHelpAfterError(true);

withFlags(
  withFlags(
    program
      .command('list')
      .description(
        'List recent Maestro projects on your account, newest first.',
      )
      .option(
        '--count <number>',
        'Maximum number of projects to return (default 10).',
        (val) => parseInt(val, 10),
      )
      .option(
        '--offset <number>',
        'Number of projects to skip, for pagination (default 0).',
        (val) => parseInt(val, 10),
      ),
    JSON_FLAGS,
  ),
  AUTH_FLAGS,
)
  .action(async (args) => {
    let jsonOptions: JsonOutputOptions | undefined;
    try {
      jsonOptions = jsonOptionsFrom(args);
      const credentials = await requireCredentials(args);
      if (args.debug) enableDebugLogging();
      const maestro = new Maestro(
        credentials,
        MaestroOptions.forExistingProject({ quiet: true, debug: args.debug }),
      );
      const page = await maestro.listProjects({
        count: args.count,
        offset: args.offset,
      });
      const projects = page.data.map((project) => ({
        id: project.id,
        name: project.name,
        completed: project.completed,
        createdAt: project.created_at,
        runs: project.runs,
        flows: (project.flows ?? []).map((flow) => flow.name),
        bundleId: project.app?.bundle_id ?? undefined,
        appVersion: project.app?.app_version ?? undefined,
        url: `https://testingbot.com/members/maestro/${project.id}`,
      }));
      const output = {
        provider: 'maestro' as const,
        meta: page.meta,
        projects,
      };
      const written = await writeJsonOutput(output, jsonOptions);
      if (!jsonOptions.json) {
        printProjectList(projects, page.meta);
        if (written) logger.info(`JSON results written to ${written}`);
      }
      process.exitCode = 0;
    } catch (err) {
      await failCommand('maestro', 'List', err, jsonOptions);
    }
  })
  .showHelpAfterError(true);

function printProjectList(
  projects: Array<{
    id: number;
    name: string;
    completed: boolean;
    createdAt: string;
    runs: number[];
    flows: string[];
    url: string;
  }>,
  meta: { offset: number; count: number; total: number },
): void {
  if (projects.length === 0) {
    console.log('No Maestro projects found.');
    return;
  }
  const idWidth = Math.max(2, ...projects.map((p) => String(p.id).length));
  const nameWidth = Math.min(
    40,
    Math.max(4, ...projects.map((p) => p.name.length)),
  );
  const header = `${'ID'.padEnd(idWidth)}  ${'NAME'.padEnd(nameWidth)}  ${'STATE'.padEnd(9)}  ${'RUNS'.padEnd(4)}  ${'FLOWS'.padEnd(5)}  CREATED`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const p of projects) {
    const name =
      p.name.length > nameWidth ? `${p.name.slice(0, nameWidth - 1)}…` : p.name;
    console.log(
      `${String(p.id).padEnd(idWidth)}  ${name.padEnd(nameWidth)}  ${(p.completed ? 'completed' : 'running').padEnd(9)}  ${String(p.runs.length).padEnd(4)}  ${String(p.flows.length).padEnd(5)}  ${p.createdAt}`,
    );
  }
  const shownTo = meta.offset + projects.length;
  console.log(
    `\nShowing ${meta.offset + 1}-${shownTo} of ${meta.total}. Use --offset ${shownTo} for the next page.`,
  );
}

program
  .command('login')
  .description('Authenticate with TestingBot via browser.')
  .action(async () => {
    try {
      const login = new Login();
      const result = await login.run();
      if (!result.success) {
        process.exitCode = 1;
      }
    } catch (err) {
      logger.error(`Login error: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

export default program;
