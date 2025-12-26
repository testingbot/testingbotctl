import { Command } from 'commander';
import logger from './logger';
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

const program = new Command();

program
  .name('testingbot')
  .version(packageJson.version, '-v, --version', 'Show version number')
  .description(
    'CLI tool to run Espresso, XCUITest and Maestro tests on TestingBot cloud',
  );

const espressoCommand = program
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
    '--geo-location <code>',
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
  .option('--pull-request-id <id>', 'The ID of the pull request this upload originated from.')
  .option('--repo-name <name>', 'Repository name (e.g., GitHub repo slug).')
  .option('--repo-owner <owner>', 'Repository owner (e.g., GitHub organization or user slug).')
  // Authentication
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .action(async (appFileArg, testAppFileArg, args) => {
    try {
      // Positional arguments take precedence, fall back to options
      const app = appFileArg || args.app;
      const testApp = testAppFileArg || args.testApp;

      if (!app || !testApp) {
        espressoCommand.help();
        return;
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
        geoLocation: args.geoLocation,
        throttleNetwork: args.throttleNetwork,
        quiet: args.quiet,
        async: args.async,
        report: args.report,
        reportOutputDir: args.reportOutputDir,
        metadata,
      });
      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new Error(
          'No TestingBot credentials found. Please authenticate using one of these methods:\n' +
            '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
            '  2. Use --api-key and --api-secret options\n' +
            '  3. Set TB_KEY and TB_SECRET environment variables\n' +
            '  4. Create ~/.testingbot file with content: key:secret',
        );
      }
      const espresso = new Espresso(credentials, options);
      const result = await espresso.run();
      if (!result.success) {
        process.exitCode = 1;
      }
    } catch (err) {
      logger.error(
        `Espresso error: ${err instanceof Error ? err.message : err}`,
      );
      process.exitCode = 1;
    }
  })
  .showHelpAfterError(true);

const maestroCommand = program
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
    '--maestro-version <version>',
    'Maestro version to use (e.g., "2.0.10").',
  )
  // Execution mode
  .option('-q, --quiet', 'Quieter console output without progress updates.')
  .option(
    '--async',
    'Start tests and exit immediately without waiting for results.',
  )
  // Report options
  .option(
    '--report <format>',
    'Download test report after completion: html or junit.',
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
  .option('--pull-request-id <id>', 'The ID of the pull request this upload originated from.')
  .option('--repo-name <name>', 'Repository name (e.g., GitHub repo slug).')
  .option('--repo-owner <owner>', 'Repository owner (e.g., GitHub organization or user slug).')
  // Authentication
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .action(async (appFileArg, flowsArgs, args) => {
    try {
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

      if (!app || flows.length === 0) {
        maestroCommand.help();
        return;
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
        quiet: args.quiet,
        async: args.async,
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
        metadata,
      });
      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new Error(
          'No TestingBot credentials found. Please authenticate using one of these methods:\n' +
            '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
            '  2. Use --api-key and --api-secret options\n' +
            '  3. Set TB_KEY and TB_SECRET environment variables\n' +
            '  4. Create ~/.testingbot file with content: key:secret',
        );
      }
      const maestro = new Maestro(credentials, options);
      const result = await maestro.run();
      if (!result.success) {
        process.exitCode = 1;
      }
    } catch (err) {
      logger.error(
        `Maestro error: ${err instanceof Error ? err.message : err}`,
      );
      process.exitCode = 1;
    }
  })
  .showHelpAfterError(true);

const xcuitestCommand = program
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
    '--geo-location <code>',
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
  .option('--pull-request-id <id>', 'The ID of the pull request this upload originated from.')
  .option('--repo-name <name>', 'Repository name (e.g., GitHub repo slug).')
  .option('--repo-owner <owner>', 'Repository owner (e.g., GitHub organization or user slug).')
  // Authentication
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .action(async (appFileArg, testAppFileArg, args) => {
    try {
      // Positional arguments take precedence, fall back to options
      const app = appFileArg || args.app;
      const testApp = testAppFileArg || args.testApp;

      if (!app || !testApp) {
        xcuitestCommand.help();
        return;
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
        geoLocation: args.geoLocation,
        throttleNetwork: args.throttleNetwork,
        quiet: args.quiet,
        async: args.async,
        report: args.report,
        reportOutputDir: args.reportOutputDir,
        metadata,
      });
      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new Error(
          'No TestingBot credentials found. Please authenticate using one of these methods:\n' +
            '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
            '  2. Use --api-key and --api-secret options\n' +
            '  3. Set TB_KEY and TB_SECRET environment variables\n' +
            '  4. Create ~/.testingbot file with content: key:secret',
        );
      }
      const xcuitest = new XCUITest(credentials, options);
      const result = await xcuitest.run();
      if (!result.success) {
        process.exitCode = 1;
      }
    } catch (err) {
      logger.error(
        `XCUITest error: ${err instanceof Error ? err.message : err}`,
      );
      process.exitCode = 1;
    }
  })
  .showHelpAfterError(true);

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
