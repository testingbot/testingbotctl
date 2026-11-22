import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import {
  detectInstall,
  runUpgrade,
  type Install,
} from '../../src/commands/upgrade';

const entry = (prefix: string) =>
  `${prefix}/node_modules/@testingbot/cli/dist/index.js`;

describe('detectInstall', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tb-up-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('recognises global installs by package manager', () => {
    expect(detectInstall(entry('/usr/local/lib')).command).toEqual([
      'npm',
      'install',
      '-g',
      '@testingbot/cli@latest',
    ]);
    expect(detectInstall(entry('/Users/me/Library/pnpm/global/5')).kind).toBe(
      'pnpm',
    );
    expect(
      detectInstall(entry('/home/me/.config/yarn/global')).command,
    ).toEqual(['yarn', 'global', 'add', '@testingbot/cli@latest']);
    expect(detectInstall(entry('/home/me/.bun/install/global')).kind).toBe(
      'bun',
    );
    expect(
      detectInstall(
        entry('C:\\Users\\me\\AppData\\Roaming\\npm').replace(/\//g, '\\'),
      ).kind,
    ).toBe('npm');
  });

  it('only prints the command for a project dependency, with its package manager', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const install = detectInstall(entry(dir));
    expect(install).toEqual({
      kind: 'project',
      command: ['pnpm', 'add', '-D', '@testingbot/cli@latest'],
      runnable: false,
      cwd: dir,
    });
  });

  it('recognises npx, source checkouts and other copies', () => {
    expect(detectInstall(entry('/home/me/.npm/_npx/0123abcd')).kind).toBe(
      'npx',
    );
    fs.mkdirSync(path.join(dir, '.git'));
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), '');
    expect(detectInstall(path.join(dir, 'dist', 'index.js')).kind).toBe(
      'source',
    );
    const copy = detectInstall('/opt/no-such-copy/dist/index.js');
    expect(copy.kind).toBe('unknown');
    expect(copy.runnable).toBe(false);
  });
});

describe('runUpgrade', () => {
  const npm: Install = {
    kind: 'npm',
    command: ['npm', 'install', '-g', '@testingbot/cli@latest'],
    runnable: true,
  };
  const setup = (overrides: Record<string, unknown> = {}) => {
    const lines: string[] = [];
    const run = jest.fn().mockResolvedValue(0);
    const deps = {
      current: '1.5.0',
      latest: jest.fn().mockResolvedValue('1.6.0'),
      install: npm,
      run,
      log: (l: string) => lines.push(stripVTControlCharacters(l)),
      ...overrides,
    };
    return { deps, run, text: () => lines.join('\n') };
  };

  it('says so when already up to date and runs nothing', async () => {
    const { deps, run, text } = setup({
      latest: jest.fn().mockResolvedValue('1.5.0'),
    });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(text()).toContain('1.5.0 is the latest version');
  });

  it('runs the install command for a global install', async () => {
    const { deps, run, text } = setup();
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(run).toHaveBeenCalledWith(npm.command, undefined);
    expect(text()).toContain('1.5.0 → 1.6.0');
    expect(text()).toContain('Updated to 1.6.0');
  });

  it('only shows the command with --dry-run', async () => {
    const { deps, run, text } = setup();
    expect(await runUpgrade({ dryRun: true }, deps)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(text()).toContain(
      'Would run: npm install -g @testingbot/cli@latest',
    );
  });

  it('never changes a project on its own', async () => {
    const { deps, run, text } = setup({
      install: {
        kind: 'project',
        command: ['npm', 'install', '--save-dev', '@testingbot/cli@latest'],
        runnable: false,
        cwd: '/work/app',
      },
    });
    expect(await runUpgrade({}, deps)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(text()).toContain(
      'Update it in /work/app with: npm install --save-dev @testingbot/cli@latest',
    );
  });

  it('fails with a way forward when the install fails', async () => {
    const { deps, text } = setup({ run: jest.fn().mockResolvedValue(243) });
    expect(await runUpgrade({}, deps)).toBe(1);
    expect(text()).toContain('The update failed (exit 243)');
  });

  it('fails when the registry cannot be reached', async () => {
    const { deps, run, text } = setup({
      latest: jest.fn().mockResolvedValue(undefined),
    });
    expect(await runUpgrade({}, deps)).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(text()).toContain('Could not reach the npm registry');
  });
});
