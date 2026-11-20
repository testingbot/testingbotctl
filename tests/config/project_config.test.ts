import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command, Option } from 'commander';
import {
  applyProjectConfig,
  camelCase,
  findConfigFile,
  loadProjectConfig,
  type AppliedConfig,
} from '../../src/config/project_config';

let dir: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tb-config-')));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeConfig(content: string, where = dir): string {
  const file = path.join(where, '.testingbot.yml');
  fs.writeFileSync(file, content);
  return file;
}

/** A command shaped like `testingbot maestro`, applying the config like the CLI. */
function maestroLike(file: string) {
  let applied: AppliedConfig | undefined;
  let opts: Record<string, unknown> = {};
  let positionals: string[] = [];
  const command = new Command('maestro')
    .exitOverride()
    .argument('[appFile]')
    .argument('[flows...]')
    .option('--app <path>')
    .option('--device <device>')
    .option('--deviceVersion <version>')
    .option('--retry <count>', 'retries', (v) => parseInt(v, 10), 0)
    .option('--other-app <path>', 'repeatable', (v: string, acc?: string[]) => [
      ...(acc ?? []),
      v,
    ])
    .option(
      '-e, --env <KEY=VALUE>',
      'pushes onto its default, like the real --env',
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option('--real-device')
    .option('--disable-animations')
    .option('--no-disable-animations')
    .option('--api-key <key>')
    .addOption(new Option('--flows <flows>').hideHelp())
    .hook('preAction', (cmd) => {
      applied = applyProjectConfig(cmd, loadProjectConfig(file));
    })
    .action((app, flows, o) => {
      opts = o;
      positionals = [app, ...(flows ?? [])].filter(Boolean);
    });
  return {
    run: (argv: string[]) => {
      command.parse(argv, { from: 'user' });
      return { opts, positionals, applied: applied as AppliedConfig };
    },
  };
}

describe('findConfigFile', () => {
  it('finds the file in a parent directory', () => {
    const file = writeConfig('maestro: {}');
    const sub = path.join(dir, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    expect(findConfigFile(sub, {})).toBe(file);
  });

  it('honours TESTINGBOT_CONFIG, including turning it off', () => {
    writeConfig('maestro: {}');
    expect(findConfigFile(dir, { TESTINGBOT_CONFIG: 'none' })).toBeUndefined();
    const other = path.join(dir, 'ci.yml');
    fs.writeFileSync(other, 'maestro: {}');
    expect(findConfigFile('/', { TESTINGBOT_CONFIG: other })).toBe(other);
    expect(() =>
      findConfigFile(dir, { TESTINGBOT_CONFIG: 'missing.yml' }),
    ).toThrow(/does not exist/);
  });
});

describe('loadProjectConfig', () => {
  it('accepts flag-style keys', () => {
    expect(camelCase('device-version')).toBe('deviceVersion');
    expect(camelCase('--include-tags')).toBe('includeTags');
    const config = loadProjectConfig(
      writeConfig('maestro:\n  device-version: "15"\n'),
    );
    expect(config.commands.maestro).toEqual({ deviceVersion: '15' });
  });

  it('explains malformed files', () => {
    expect(() => loadProjectConfig(writeConfig('maestro: [1, 2]'))).toThrow(
      /should be a map of options/,
    );
    expect(() => loadProjectConfig(writeConfig('maestro: {'))).toThrow(
      /Could not read/,
    );
    expect(() => loadProjectConfig(writeConfig('- a\n- b'))).toThrow(
      /should map command names/,
    );
  });
});

describe('applyProjectConfig', () => {
  it('fills unset options, coerces values and resolves paths against the file', () => {
    const file = writeConfig(
      [
        'maestro:',
        '  app: build/app.apk',
        '  flows: [.maestro, extra/login.yaml]',
        '  device: Pixel 9',
        '  deviceVersion: 15',
        '  retry: 1',
        '  other-app: [a.apk, b.apk]',
        '  real-device: true',
        '  disable-animations: false',
      ].join('\n'),
    );
    const { opts, applied } = maestroLike(file).run([]);
    expect(opts.app).toBe(path.join(dir, 'build/app.apk'));
    expect(opts.flows).toBe(
      `${path.join(dir, '.maestro')},${path.join(dir, 'extra/login.yaml')}`,
    );
    expect(opts.device).toBe('Pixel 9');
    expect(opts.deviceVersion).toBe('15');
    expect(opts.retry).toBe(1);
    expect(opts.otherApp).toEqual([
      path.join(dir, 'a.apk'),
      path.join(dir, 'b.apk'),
    ]);
    expect(opts.realDevice).toBe(true);
    expect(opts.disableAnimations).toBe(false);
    expect(applied.keys).toContain('device');
    expect(applied.warnings).toEqual([]);
  });

  it('lets the command line win', () => {
    const file = writeConfig('maestro:\n  device: Pixel 9\n  retry: 2\n');
    const { opts } = maestroLike(file).run([
      '--device',
      'Galaxy S24',
      '--retry',
      '0',
    ]);
    expect(opts.device).toBe('Galaxy S24');
    expect(opts.retry).toBe(0);
  });

  it('drops configured flows when flows are given on the command line', () => {
    const file = writeConfig('maestro:\n  app: app.apk\n  flows: [.maestro]\n');
    const { opts } = maestroLike(file).run(['only.yaml']);
    expect(opts.app).toBe(path.join(dir, 'app.apk'));
    expect(opts.flows).toBeUndefined();
  });

  it('drops the configured app when an app is given on the command line', () => {
    const file = writeConfig('maestro:\n  app: app.apk\n  flows: [.maestro]\n');
    const { opts } = maestroLike(file).run(['other.apk']);
    expect(opts.app).toBeUndefined();
    expect(opts.flows).toBe(path.join(dir, '.maestro'));
  });

  it('warns about unknown keys and commands, with suggestions, and refuses credentials', () => {
    const file = writeConfig(
      'maestro:\n  devcie: Pixel 9\n  apiKey: abc\nmaestor:\n  device: x\n',
    );
    const { opts, applied } = maestroLike(file).run([]);
    expect(opts.apiKey).toBeUndefined();
    expect(applied.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Unknown option "devcie" for maestro in .testingbot.yml. Did you mean "device"?',
        ),
        expect.stringContaining('keep credentials out of a file you commit'),
        expect.stringContaining('Did you mean "maestro"?'),
      ]),
    );
  });

  it('rejects a list for an on/off option', () => {
    const file = writeConfig('maestro:\n  real-device: [true]\n');
    expect(() => maestroLike(file).run([])).toThrow(/use true or false/);
  });

  it('fills list options whose parser pushes onto the default', () => {
    const file = writeConfig('maestro:\n  env: [A=1, B=2]\n');
    expect(maestroLike(file).run([]).opts.env).toEqual(['A=1', 'B=2']);
    // The default array itself is not mutated.
    expect(maestroLike(file).run([]).opts.env).toEqual(['A=1', 'B=2']);
  });

  it('keeps URLs as they are', () => {
    const file = writeConfig('maestro:\n  app: https://example.com/app.apk\n');
    expect(maestroLike(file).run([]).opts.app).toBe(
      'https://example.com/app.apk',
    );
  });
});
