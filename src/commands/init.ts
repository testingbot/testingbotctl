import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import pc from 'picocolors';
import TestingBotError from '../models/testingbot_error';
import type { DeviceFramework } from '../providers/account';
import { cachedDevices } from '../utils/device_check';
import { CONFIG_FILE_NAMES } from '../config/project_config';

/**
 * `testingbot init`: looks at the project, then writes `.testingbot.yml` with
 * the app, flows/test app and a device, so `testingbot <framework>` runs with
 * no arguments. `--ci github` also writes a GitHub Actions workflow.
 * Never overwrites a file without --force.
 */

const IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/Pods/**',
  '**/.gradle/**',
  '**/DerivedData/**/Index/**',
];
const MAX_DEPTH = 8;

export interface Detected {
  framework: DeviceFramework;
  app?: string;
  testApp?: string;
  flows?: string;
  device: string;
}

async function find(cwd: string, pattern: string, dirs = false) {
  const found = await glob(pattern, {
    cwd,
    ignore: IGNORE,
    maxDepth: MAX_DEPTH,
    nodir: !dirs,
    dot: false,
    posix: true,
  });
  // Shortest paths first: the top-level build, not a nested intermediate.
  return found.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

const isAndroidTest = (p: string) =>
  /androidTest|-test\.apk$|Test\.apk$/i.test(p);

/** Prefers debug builds, which is what tests normally run against. */
function pickApp(paths: string[]): string | undefined {
  return paths.find((p) => /debug/i.test(p)) ?? paths[0];
}

async function findFlowsDir(cwd: string): Promise<string | undefined> {
  if (fs.existsSync(path.join(cwd, '.maestro'))) return '.maestro';
  const yamls = await find(cwd, '**/*.{yaml,yml}');
  for (const file of yamls) {
    if (CONFIG_FILE_NAMES.includes(path.basename(file))) continue;
    if (file.startsWith('.github/')) continue;
    const head = fs.readFileSync(path.join(cwd, file), 'utf8').slice(0, 2000);
    // A Maestro flow starts with a config section naming the app, then `---`.
    if (/^\s*(appId|url)\s*:/m.test(head) && /^---\s*$/m.test(head)) {
      return path.dirname(file) === '.' ? file : path.dirname(file);
    }
  }
  return undefined;
}

/**
 * A sensible first device: the newest Pixel or iPhone in the cached catalog
 * (the most common choice), else any phone, else a well-known name.
 */
function defaultDevice(framework: DeviceFramework, ios: boolean): string {
  const devices = cachedDevices(framework) ?? [];
  const platform = ios ? 'iOS' : 'Android';
  const phones = devices.filter(
    (d) => d.platform === platform && (d.type ?? 'phone') === 'phone',
  );
  const flagship = ios ? /^iPhone (\d+)$/ : /^Pixel (\d+)$/;
  const newest = phones
    .map((d) => ({ d, n: Number(flagship.exec(d.name)?.[1] ?? NaN) }))
    .filter((x) => !Number.isNaN(x.n))
    .sort((a, b) => b.n - a.n)[0]?.d;
  return newest?.name ?? phones[0]?.name ?? (ios ? 'iPhone 16' : 'Pixel 9');
}

export async function detectProject(
  cwd: string,
  framework?: DeviceFramework,
): Promise<Detected> {
  const apks = (await find(cwd, '**/*.apk')).filter(
    (p) => !p.includes('/intermediates/'),
  );
  const ipas = await find(cwd, '**/*.ipa');
  const simApps = (await find(cwd, '**/*.app', true)).filter((p) =>
    /iphonesimulator|Simulator/i.test(p),
  );
  const flows = await findFlowsDir(cwd);
  const hasXcode =
    (await find(cwd, '*.{xcodeproj,xcworkspace}', true)).length > 0 ||
    (await find(cwd, '*/*.{xcodeproj,xcworkspace}', true)).length > 0;

  const resolved: DeviceFramework =
    framework ??
    (flows
      ? 'maestro'
      : apks.some(isAndroidTest)
        ? 'espresso'
        : hasXcode || ipas.length > 0
          ? 'xcuitest'
          : 'maestro');

  if (resolved === 'espresso') {
    return {
      framework: resolved,
      app: pickApp(apks.filter((p) => !isAndroidTest(p))),
      testApp: pickApp(apks.filter(isAndroidTest)),
      device: defaultDevice(resolved, false),
    };
  }
  if (resolved === 'xcuitest') {
    return {
      framework: resolved,
      app:
        ipas.find((p) => !/UITests?-Runner|Tests?\.ipa$/i.test(p)) ?? ipas[0],
      testApp: (await find(cwd, '**/*{UITests,Tests}*.zip'))[0],
      device: defaultDevice(resolved, true),
    };
  }
  // Maestro: Android unless there is only an iOS build.
  const androidApp = pickApp(apks.filter((p) => !isAndroidTest(p)));
  const iosApp = simApps[0] ?? ipas[0];
  const ios = !androidApp && (Boolean(iosApp) || hasXcode);
  return {
    framework: resolved,
    app: androidApp ?? iosApp,
    flows: flows ?? '.maestro',
    device: defaultDevice(resolved, ios),
  };
}

function yamlString(value: string): string {
  return /^[\w./@-][\w ./@-]*$/.test(value) &&
    !/^(true|false|null|yes|no|\d+(\.\d+)?)$/i.test(value)
    ? value
    : JSON.stringify(value);
}

export function renderConfig(d: Detected): string {
  const lines = [
    `# TestingBot CLI defaults: "testingbot ${d.framework}" runs with these.`,
    '# Options typed on the command line win. Paths are relative to this file.',
    `# Every option: testingbot ${d.framework} --help (use the flag name or camelCase).`,
    `${d.framework}:`,
  ];
  const appLine = d.app
    ? `  app: ${yamlString(d.app)}`
    : '  # app: path/to/your/app  # build the app, then set its path';
  lines.push(appLine);
  if (d.framework === 'maestro') {
    lines.push('  flows:', `    - ${yamlString(d.flows ?? '.maestro')}`);
  } else {
    lines.push(
      d.testApp
        ? `  test-app: ${yamlString(d.testApp)}`
        : '  # test-app: path/to/your/test-app',
    );
  }
  lines.push(`  device: ${yamlString(d.device)}`);
  const version =
    d.framework === 'maestro' ? 'deviceVersion' : 'platform-version';
  lines.push(
    `  # ${version}: "15"`,
    '  # retry: 1',
    '  # report: junit',
    '  # report-output-dir: reports',
    '',
  );
  return lines.join('\n');
}

export function renderGithubWorkflow(d: Detected): string {
  return [
    'name: TestingBot',
    '',
    'on:',
    '  pull_request:',
    '  push:',
    '    branches: [main]',
    '  workflow_dispatch:',
    '',
    'jobs:',
    `  ${d.framework}:`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 20',
    '      # Build your app here so the paths in .testingbot.yml exist.',
    `      - name: Run ${d.framework} tests on TestingBot`,
    `        run: npx --yes @testingbot/cli ${d.framework} --report junit --report-output-dir reports`,
    '        env:',
    '          TB_KEY: ${{ secrets.TB_KEY }}',
    '          TB_SECRET: ${{ secrets.TB_SECRET }}',
    '      - uses: actions/upload-artifact@v4',
    '        if: always()',
    '        with:',
    '          name: testingbot-reports',
    '          path: reports',
    '',
  ].join('\n');
}

export interface InitOptions {
  framework?: DeviceFramework;
  ci?: string;
  force?: boolean;
  cwd?: string;
}

export interface InitResult {
  detected: Detected;
  written: string[];
}

function writeNew(file: string, content: string, force?: boolean): void {
  if (fs.existsSync(file) && !force) {
    throw new TestingBotError(
      `${path.relative(process.cwd(), file) || file} already exists. Use --force to overwrite it.`,
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  if (options.ci && options.ci !== 'github') {
    throw new TestingBotError(
      `Unsupported --ci "${options.ci}": only "github" (GitHub Actions) is available.`,
    );
  }
  const detected = await detectProject(cwd, options.framework);
  const written: string[] = [];

  // Check everything before writing anything.
  const configFile = path.join(cwd, CONFIG_FILE_NAMES[0]);
  const workflowFile = path.join(cwd, '.github', 'workflows', 'testingbot.yml');
  for (const file of options.ci ? [configFile, workflowFile] : [configFile]) {
    if (fs.existsSync(file) && !options.force) writeNew(file, '', false);
  }

  writeNew(configFile, renderConfig(detected), options.force);
  written.push(configFile);
  if (options.ci === 'github') {
    writeNew(workflowFile, renderGithubWorkflow(detected), options.force);
    written.push(workflowFile);
  }
  return { detected, written };
}

/** The human summary printed by `testingbot init`. */
export function initSummary(result: InitResult, cwd = process.cwd()): string[] {
  const d = result.detected;
  const rel = (p: string) => path.relative(cwd, p) || p;
  const check = (value: string | undefined, label: string) =>
    value
      ? `  ${pc.green('✔')} ${label.padEnd(9)} ${value}`
      : `  ${pc.yellow('!')} ${label.padEnd(9)} ${pc.yellow('not found: set it in .testingbot.yml after your build')}`;
  const lines = [
    `Detected a ${pc.bold(d.framework)} project:`,
    check(d.app, 'App'),
  ];
  if (d.framework === 'maestro') lines.push(check(d.flows, 'Flows'));
  else lines.push(check(d.testApp, 'Test app'));
  lines.push(`  ${pc.green('✔')} ${'Device'.padEnd(9)} ${d.device}`, '');
  for (const file of result.written) lines.push(`Wrote ${pc.cyan(rel(file))}`);
  const next: Array<[string, string]> = [
    [`testingbot ${d.framework}`, 'run with these defaults'],
    [`testingbot devices --framework ${d.framework}`, 'pick another device'],
    ['testingbot completion --help', 'Tab-complete devices and options'],
  ];
  const width = Math.max(...next.map(([cmd]) => cmd.length));
  lines.push('', 'Next:');
  for (const [cmd, what] of next) {
    lines.push(`  ${pc.cyan(cmd.padEnd(width))}  ${pc.dim(what)}`);
  }
  if (result.written.some((f) => f.includes('.github'))) {
    lines.push(
      `  Add ${pc.cyan('TB_KEY')} and ${pc.cyan('TB_SECRET')} as repository secrets for the workflow.`,
    );
  }
  return lines;
}
