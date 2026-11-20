import { Command, type Option } from 'commander';
import pc from 'picocolors';

/**
 * Help layout: options sorted into a few named groups instead of one long
 * list, an "Examples" section for the run commands, and the root commands
 * grouped by what they are for. Applied after every command is defined, so
 * the option definitions themselves stay as they are.
 */

const GROUP = {
  app: 'App & tests:',
  device: 'Device:',
  select: 'Choosing tests:',
  run: 'Running:',
  results: 'Reports & artifacts:',
  ci: 'CI & Git metadata:',
  output: 'Output:',
  auth: 'Authentication:',
} as const;

const GROUP_ORDER: string[] = [
  GROUP.app,
  GROUP.device,
  GROUP.select,
  GROUP.run,
  GROUP.results,
  GROUP.ci,
  GROUP.output,
  GROUP.auth,
];

/** Long flag → group. Flags not listed stay under "Options:". */
const OPTION_GROUPS: Record<string, string> = {
  // App & tests
  '--app': GROUP.app,
  '--app-url': GROUP.app,
  '--app-binary-id': GROUP.app,
  '--other-app': GROUP.app,
  '--test-app': GROUP.app,
  '--ignore-checksum-check': GROUP.app,
  '--id': GROUP.app,
  // Device
  '--device': GROUP.device,
  '--platform': GROUP.device,
  '--platform-version': GROUP.device,
  '--deviceVersion': GROUP.device,
  '--real-device': GROUP.device,
  '--device-matrix': GROUP.device,
  '--tablet-only': GROUP.device,
  '--phone-only': GROUP.device,
  '--google-play': GROUP.device,
  '--disable-animations': GROUP.device,
  '--no-disable-animations': GROUP.device,
  '--orientation': GROUP.device,
  '--locale': GROUP.device,
  '--device-locale': GROUP.device,
  '--language': GROUP.device,
  '--timezone': GROUP.device,
  '--geo-country-code': GROUP.device,
  '--throttle-network': GROUP.device,
  // Choosing tests
  '--include-tags': GROUP.select,
  '--exclude-tags': GROUP.select,
  '--exclude-flows': GROUP.select,
  '--env': GROUP.select,
  '--secret-env': GROUP.select,
  '--config': GROUP.select,
  '--maestro-version': GROUP.select,
  '--test-runner': GROUP.select,
  '--class': GROUP.select,
  '--not-class': GROUP.select,
  '--package': GROUP.select,
  '--not-package': GROUP.select,
  '--annotation': GROUP.select,
  '--not-annotation': GROUP.select,
  '--size': GROUP.select,
  '--only-testing': GROUP.select,
  '--skip-testing': GROUP.select,
  '--test-env': GROUP.select,
  '--test-arg': GROUP.select,
  '--app-env': GROUP.select,
  '--app-arg': GROUP.select,
  '--run': GROUP.select,
  '--flow': GROUP.select,
  // Running
  '--name': GROUP.run,
  '--build': GROUP.run,
  '--groups': GROUP.run,
  '--retry': GROUP.run,
  '--timeout': GROUP.run,
  '--fail-fast': GROUP.run,
  '--max-failures': GROUP.run,
  '--shard-split': GROUP.run,
  '--priority': GROUP.run,
  '--async': GROUP.run,
  '--wait': GROUP.run,
  '--dry-run': GROUP.run,
  '--tunnel': GROUP.run,
  '--tunnel-identifier': GROUP.run,
  '--cancel-previous': GROUP.run,
  // Reports & artifacts
  '--report': GROUP.results,
  '--report-output-dir': GROUP.results,
  '--download-artifacts': GROUP.results,
  '--artifacts-output-dir': GROUP.results,
  // CI & Git
  '--branch': GROUP.ci,
  '--commit-sha': GROUP.ci,
  '--pr-url': GROUP.ci,
  '--pull-request-id': GROUP.ci,
  '--repo-name': GROUP.ci,
  '--repo-owner': GROUP.ci,
  '--metadata': GROUP.ci,
  '--check-name': GROUP.ci,
  // Output
  '--quiet': GROUP.output,
  '--json': GROUP.output,
  '--json-file': GROUP.output,
  '--json-file-name': GROUP.output,
  '--debug': GROUP.output,
  // Authentication
  '--api-key': GROUP.auth,
  '--api-secret': GROUP.auth,
};

/** Commands with enough options to be worth grouping. */
const GROUPED_COMMANDS = new Set([
  'espresso',
  'maestro',
  'xcuitest',
  'rerun',
  'artifacts',
]);

const EXAMPLES: Record<string, Array<[string, string]>> = {
  maestro: [
    [
      'Run every flow in .maestro on a Pixel 9',
      'testingbot maestro app.apk .maestro --device "Pixel 9"',
    ],
    [
      'Same flows on several devices at once',
      'testingbot maestro app.apk .maestro --device-matrix "Pixel 9:15,Galaxy S24:14"',
    ],
    [
      'iOS simulator, only flows tagged smoke',
      'testingbot maestro app.zip .maestro --device "iPhone 16" --include-tags smoke',
    ],
    [
      'Retry flaky flows and save a JUnit report',
      'testingbot maestro app.apk .maestro --retry 1 --report junit --report-output-dir reports',
    ],
    [
      'Start in CI and check back later',
      'testingbot maestro app.apk .maestro --async  →  testingbot status --id <id> --wait',
    ],
  ],
  espresso: [
    [
      'Run on a Pixel 8 emulator',
      'testingbot espresso app.apk app-test.apk --device "Pixel 8" --platform-version 14',
    ],
    [
      'Only one test class, on a real device',
      'testingbot espresso app.apk app-test.apk --device "Pixel 8" --real-device --class com.example.LoginTest',
    ],
    [
      'JUnit report for CI',
      'testingbot espresso app.apk app-test.apk --report junit --report-output-dir reports',
    ],
  ],
  xcuitest: [
    [
      'Run on an iPhone 16 simulator',
      'testingbot xcuitest app.ipa tests.zip --device "iPhone 16" --platform-version 18.2',
    ],
    [
      'Only some tests',
      'testingbot xcuitest app.ipa tests.zip --only-testing LoginTests/testValidLogin',
    ],
    [
      'JUnit report for CI',
      'testingbot xcuitest app.ipa tests.zip --report junit --report-output-dir reports',
    ],
  ],
  status: [
    [
      'Wait for a run started with --async',
      'testingbot status --id 1234 --wait',
    ],
  ],
  rerun: [
    ['Re-run every failed flow', 'testingbot rerun --id 1234'],
    [
      'Re-run one flow, even if it passed',
      'testingbot rerun --id 1234 --flow login.yaml',
    ],
  ],
  artifacts: [
    [
      'Videos and logs of the failed flows',
      'testingbot artifacts --id 1234 --download-artifacts failed',
    ],
    [
      'HTML report',
      'testingbot artifacts --id 1234 --report html --report-output-dir reports',
    ],
  ],
  devices: [
    ['Android emulators for Maestro', 'testingbot devices --platform android'],
    [
      'Real iOS devices, with availability',
      'testingbot devices --framework xcuitest --real',
    ],
  ],
};

/** Root command → group in `testingbot --help`. */
const COMMAND_GROUPS: Record<string, string> = {
  maestro: 'Run tests:',
  espresso: 'Run tests:',
  xcuitest: 'Run tests:',
  status: 'Maestro projects:',
  rerun: 'Maestro projects:',
  artifacts: 'Maestro projects:',
  upload: 'Maestro projects:',
  list: 'Maestro projects:',
  init: 'Setup:',
  login: 'Setup:',
  logout: 'Setup:',
  whoami: 'Setup:',
  doctor: 'Setup:',
  completion: 'Setup:',
  devices: 'Utilities:',
  'failed-tests': 'Utilities:',
};

export function examplesText(name: string): string | undefined {
  const examples = EXAMPLES[name];
  if (!examples) return undefined;
  const lines = ['', 'Examples:'];
  for (const [what, cmd] of examples) {
    lines.push(`  ${pc.dim(`# ${what}`)}`);
    lines.push(`  $ ${cmd}`);
  }
  return lines.join('\n');
}

export function applyHelpLayout(program: Command): void {
  for (const command of program.commands) {
    const name = command.name();
    const group = COMMAND_GROUPS[name];
    if (group) command.helpGroup(group);

    if (GROUPED_COMMANDS.has(name)) {
      for (const option of command.options) {
        const heading = option.long && OPTION_GROUPS[option.long];
        if (heading) option.helpGroup(heading);
      }
      // Help lists groups in order of first appearance: sort the options so
      // the groups always come in GROUP_ORDER. Parsing does not depend on it.
      const rank = (heading: string | undefined) => {
        const i = GROUP_ORDER.indexOf(heading as string);
        return i === -1 ? GROUP_ORDER.length : i;
      };
      const sorted = command.options
        .map((option, index) => ({ option, index }))
        .sort(
          (a, b) =>
            rank(a.option.helpGroupHeading) - rank(b.option.helpGroupHeading) ||
            a.index - b.index,
        )
        .map(({ option }) => option);
      // `options` is typed readonly but is a plain array Commander iterates.
      (command.options as Option[]).splice(
        0,
        command.options.length,
        ...sorted,
      );
    }

    const examples = examplesText(name);
    if (examples) command.addHelpText('after', examples);
  }
  program.addHelpCommand(
    new Command('help')
      .argument('[command]', 'command to show help for')
      .description('Show help for a command.')
      .helpGroup('Utilities:'),
  );
  program.addHelpText(
    'after',
    [
      '',
      `Run ${pc.cyan('testingbot <command> --help')} for the options of a command.`,
      `New here? ${pc.cyan('testingbot login')}, then ${pc.cyan('testingbot init')} in your project.`,
    ].join('\n'),
  );
}
