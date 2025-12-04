import { Command } from 'commander';
import logger from './logger';
import Auth from './auth';
import Espresso from './providers/espresso';
import EspressoOptions from './models/espresso_options';
import XCUITestOptions from './models/xcuitest_options';
import XCUITest from './providers/xcuitest';
import packageJson from '../package.json';
import MaestroOptions, {
  Orientation,
  ThrottleNetwork,
} from './models/maestro_options';
import Maestro from './providers/maestro';

const program = new Command();

program
  .version(packageJson.version)
  .description(
    'TestingBotCTL is a CLI-tool to run Espresso, XCUITest and Maestro tests in the TestingBot cloud',
  );

program
  .command('espresso')
  .description('Bootstrap an Espresso project.')
  .requiredOption('--app <string>', 'Path to application under test.')
  .requiredOption('--device <device>', 'Real device to use for testing.')
  .requiredOption(
    '--emulator <emulator>',
    'Android emulator/device to use for testing.',
  )
  .requiredOption('--test-app <string>', 'Path to test application.')
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .action(async (args) => {
    try {
      const options = new EspressoOptions(
        args.app,
        args.testApp,
        args.device,
        args.emulator,
      );
      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new Error(
          'Please specify credentials via --api-key/--api-secret, TB_KEY/TB_SECRET environment variables, or ~/.testingbot file',
        );
      }
      const espresso = new Espresso(credentials, options);
      await espresso.run();
    } catch (err) {
      logger.error(
        `Espresso error: ${err instanceof Error ? err.message : err}`,
      );
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
    '[flows]',
    'Path to flow file (.yaml/.yml), directory, .zip or glob pattern',
  )
  // App and flows options
  .option(
    '--app <string>',
    'Path to application under test (.apk, .ipa, .app, or .zip).',
  )
  .option(
    '--flows <string>',
    'Path to flow file (.yaml/.yml), directory of flows, .zip file or glob pattern.',
  )
  // Device configuration
  .option(
    '--device <device>',
    'Device name to use for testing (e.g., "Pixel 8", "iPhone 15"). If not specified, uses "*" for any available device.',
  )
  .option(
    '--platform <platform>',
    'Platform name: Android or iOS.',
    (val) => val as 'Android' | 'iOS',
  )
  .option('--version <version>', 'OS version (e.g., "14", "17.2").')
  .option(
    '--orientation <orientation>',
    'Screen orientation: PORTRAIT or LANDSCAPE.',
    (val) => val.toUpperCase() as Orientation,
  )
  .option('--locale <locale>', 'Device locale (e.g., "en_US", "de_DE").')
  .option(
    '--timezone <timezone>',
    'Device timezone (e.g., "America/New_York", "Europe/London").',
  )
  // Test metadata
  .option('--name <name>', 'Test name for identification in dashboard.')
  .option('--build <build>', 'Build identifier for grouping test runs.')
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
  // Authentication
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .action(async (appFileArg, flowsArg, args) => {
    try {
      // Positional arguments take precedence, fall back to options
      const app = appFileArg || args.app;
      const flows = flowsArg || args.flows;

      if (!app) {
        throw new Error(
          'App file is required. Provide it as first argument or use --app option.',
        );
      }
      if (!flows) {
        throw new Error(
          'Flows path is required. Provide it as second argument or use --flows option.',
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

      const options = new MaestroOptions(app, flows, args.device, {
        includeTags: args.includeTags,
        excludeTags: args.excludeTags,
        platformName: args.platform,
        version: args.version,
        name: args.name,
        build: args.build,
        orientation: args.orientation,
        locale: args.locale,
        timeZone: args.timezone,
        throttleNetwork: args.throttleNetwork,
        geoCountryCode: args.geoCountryCode,
        env: Object.keys(env).length > 0 ? env : undefined,
      });
      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new Error(
          'Please specify credentials via --api-key/--api-secret, TB_KEY/TB_SECRET environment variables, or ~/.testingbot file',
        );
      }
      const maestro = new Maestro(credentials, options);
      await maestro.run();
    } catch (err) {
      logger.error(
        `Maestro error: ${err instanceof Error ? err.message : err}`,
      );
    }
  })
  .showHelpAfterError(true);

program
  .command('xcuitest')
  .description('Bootstrap an XCUITest project.')
  .requiredOption('--app <string>', 'Path to application under test.')
  .requiredOption('--device <device>', 'Real device to use for testing.')
  .requiredOption('--test-app <string>', 'Path to test application.')
  .option('--api-key <key>', 'TestingBot API key.')
  .option('--api-secret <secret>', 'TestingBot API secret.')
  .action(async (args) => {
    try {
      const options = new XCUITestOptions(args.app, args.testApp, args.device);
      const credentials = await Auth.getCredentials({
        apiKey: args.apiKey,
        apiSecret: args.apiSecret,
      });
      if (credentials === null) {
        throw new Error(
          'Please specify credentials via --api-key/--api-secret, TB_KEY/TB_SECRET environment variables, or ~/.testingbot file',
        );
      }
      const xcuitest = new XCUITest(credentials, options);
      await xcuitest.run();
    } catch (err) {
      logger.error(
        `XCUITest error: ${err instanceof Error ? err.message : err}`,
      );
    }
  });

export default program;
