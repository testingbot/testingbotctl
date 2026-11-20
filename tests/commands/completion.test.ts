import fs from 'node:fs';
import program from '../../src/cli';
import {
  FILES,
  complete,
  completionScript,
  detectShell,
} from '../../src/commands/completion';
import { cacheDevices } from '../../src/utils/device_check';
import { stateDir } from '../../src/utils/state';

const values = (words: string[]) =>
  complete(program, words).map((l) => l.split('\t')[0]);

beforeAll(() => {
  fs.rmSync(stateDir(), { recursive: true, force: true });
  cacheDevices('maestro', false, [
    {
      name: 'Pixel 9',
      platform: 'Android',
      versions: ['15', '14'],
      real: false,
    },
    { name: 'Pixel 8', platform: 'Android', versions: ['14'], real: false },
    { name: 'iPhone 16', platform: 'iOS', versions: ['18.2'], real: false },
  ]);
  cacheDevices('espresso', false, [
    { name: 'Galaxy S24', platform: 'Android', versions: ['14'], real: false },
  ]);
});

describe('complete', () => {
  it('completes command names with descriptions, hiding internal ones', () => {
    const lines = complete(program, ['ma']);
    expect(lines).toEqual([
      expect.stringMatching(/^maestro\tRun Maestro flows/),
    ]);
    expect(values([''])).toEqual(
      expect.arrayContaining(['maestro', 'espresso', 'devices', 'completion']),
    );
    expect(values([''])).not.toContain('__complete');
  });

  it('completes options, without hidden aliases or flags already used', () => {
    const opts = values(['maestro', '--device', 'Pixel 9', '--dev']);
    expect(opts).toEqual(
      expect.arrayContaining(['--deviceVersion', '--device-matrix']),
    );
    expect(opts).not.toContain('--device');
    expect(opts).not.toContain('--device-version');
  });

  it('completes device names from the cached catalog, case-insensitively and quoted', () => {
    expect(values(['maestro', '--device', 'pix'])).toEqual([
      'Pixel 9',
      'Pixel 8',
    ]);
    expect(values(['maestro', '--device', '"Pix'])).toEqual([
      'Pixel 9',
      'Pixel 8',
    ]);
    expect(complete(program, ['maestro', '--device', 'iP'])).toEqual([
      'iPhone 16\tiOS 18.2',
    ]);
  });

  it('uses the catalog of the framework being run', () => {
    expect(values(['espresso', '--device', ''])).toEqual(['Galaxy S24']);
  });

  it('completes OS versions of a quoted or escaped device name', () => {
    expect(
      values(['maestro', '--device', '"Pixel 8"', '--deviceVersion', '']),
    ).toEqual(['14']);
    expect(
      values(['maestro', '--device', "'Pixel 8'", '--deviceVersion', '']),
    ).toEqual(['14']);
    expect(
      values(['maestro', '--device', 'Pixel\\ 8', '--deviceVersion', '']),
    ).toEqual(['14']);
  });

  it('completes OS versions of the chosen device', () => {
    expect(
      values(['maestro', '--device', 'Pixel 9', '--deviceVersion', '']),
    ).toEqual(['15', '14']);
    expect(
      values(['maestro', '--device', 'Pixel 9', '--device-version', '1']),
    ).toEqual(['15', '14']);
  });

  it('completes fixed choices', () => {
    expect(values(['maestro', '--report', ''])).toEqual([
      'html',
      'html-detailed',
      'junit',
      'allure',
    ]);
    expect(values(['devices', '--framework', 'x'])).toEqual(['xcuitest']);
    expect(values(['completion', ''])).toEqual(['bash', 'zsh', 'fish']);
  });

  it('asks the shell for file names for paths and positional arguments', () => {
    expect(complete(program, ['maestro', '--app', ''])).toEqual([FILES]);
    expect(complete(program, ['maestro', ''])).toEqual([FILES]);
    expect(complete(program, ['espresso', 'app.apk', ''])).toEqual([FILES]);
  });

  it('looks past global options to find the command', () => {
    expect(values(['--proxy', 'http://p:8080', 'maestro', '--rep'])).toEqual(
      expect.arrayContaining(['--report', '--report-output-dir']),
    );
  });
});

describe('completion scripts', () => {
  it.each(['bash', 'zsh', 'fish'] as const)(
    '%s calls back into __complete',
    (shell) => {
      const script = completionScript(shell);
      expect(script).toContain('testingbot __complete');
      expect(script).toContain(FILES);
    },
  );

  it('detects the shell from $SHELL', () => {
    expect(detectShell({ SHELL: '/bin/zsh' })).toBe('zsh');
    expect(detectShell({ SHELL: '/usr/local/bin/fish' })).toBe('fish');
    expect(detectShell({ SHELL: '/bin/tcsh' })).toBeUndefined();
  });
});
