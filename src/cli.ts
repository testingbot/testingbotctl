import { Command } from 'commander';
import logger from './logger';
import auth from './auth';
import Espresso from './providers/espresso';
import EspressoOptions from './models/espresso_options';
import XCUITestOptions from './models/xcuitest_options';
import XCUITest from './providers/xcuitest';
import packageJson from '../package.json';
import MaestroOptions from './models/maestro_options';
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
    'Android emulator to use for testing.',
  )
  .requiredOption('--test-app <string>', 'Path to test application.')
  .action(async (args) => {
    try {
      const options = new EspressoOptions(
        args.app,
        args.testApp,
        args.device,
        args.emulator,
      );
      const credentials = await auth.getCredentials();
      if (credentials === null) {
        throw new Error('Please specify credentials');
      }
      const espresso = new Espresso(credentials, options);
      await espresso.run();
    } catch (err: any) {
      logger.error(`Espresso error: ${err.message}`);
    }
  })
  .showHelpAfterError(true);

program
  .command('maestro')
  .description('Bootstrap a Maestro project.')
  .requiredOption('--app <string>', 'Path to application under test.')
  .requiredOption(
    '--device <device>',
    'Android emulator or iOS Simulator to use for testing.',
  )
  .requiredOption('--test-app <string>', 'Path to test application.')
  .action(async (args) => {
    try {
      const options = new MaestroOptions(
        args.app,
        args.testApp,
        args.device,
        args.emulator,
      );
      const credentials = await auth.getCredentials();
      if (credentials === null) {
        throw new Error('Please specify credentials');
      }
      const maestto = new Maestro(credentials, options);
      await maestto.run();
    } catch (err: any) {
      logger.error(`Maestro error: ${err.message}`);
    }
  })
  .showHelpAfterError(true);

program
  .command('xcuitest')
  .description('Bootstrap an XCUITest project.')
  .requiredOption('--app <string>', 'Path to application under test.')
  .requiredOption('--device <device>', 'Real device to use for testing.')
  .requiredOption('--test-app <string>', 'Path to test application.')
  .action(async (args) => {
    try {
      const options = new XCUITestOptions(args.app, args.testApp, args.device);
      const credentials = await auth.getCredentials();
      if (credentials === null) {
        throw new Error('Please specify credentials');
      }
      const xcuitest = new XCUITest(credentials, options);
      await xcuitest.run();
    } catch (err: any) {
      logger.error(`XCUITest error: ${err.message}`);
    }
  });

export default program;
