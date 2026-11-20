import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  compareVersions,
  recordLatestVersion,
  resetUpdateNotifierForTests,
  updateChecksEnabled,
  updateNotice,
} from '../../src/utils/update_check';
import { readState, stateDir, writeState } from '../../src/utils/state';

const STATE = 'update-check.json';

beforeEach(() => {
  resetUpdateNotifierForTests();
  fs.rmSync(path.join(stateDir(), STATE), { force: true });
});

describe('compareVersions', () => {
  it.each([
    ['1.5.0', '1.6.0', -1],
    ['1.10.0', '1.9.9', 1],
    ['1.5', '1.5.0', 0],
    ['2.0.0-beta.1', '2.0.0', 0],
  ])('%s vs %s → %d', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('updateChecksEnabled', () => {
  it('is off in CI, when opted out, and without a terminal', () => {
    expect(updateChecksEnabled({ CI: 'true' }, true)).toBe(false);
    expect(updateChecksEnabled({ NO_UPDATE_NOTIFIER: '1' }, true)).toBe(false);
    expect(updateChecksEnabled({ TESTINGBOT_NO_UPDATE_CHECK: '1' }, true)).toBe(
      false,
    );
    expect(updateChecksEnabled({}, false)).toBe(false);
    expect(updateChecksEnabled({}, true)).toBe(true);
  });
});

describe('update notice', () => {
  it('stays silent when nothing newer is known', () => {
    expect(updateNotice('1.5.0', 1000)).toBeUndefined();
    recordLatestVersion('1.5.0');
    expect(updateNotice('1.5.0', 1000)).toBeUndefined();
  });

  it('mentions a newer version announced by the API, then waits a day', () => {
    recordLatestVersion('1.6.0');
    const notice = updateNotice('1.5.0', 1_000_000);
    expect(notice).toContain('1.6.0');
    expect(notice).toContain('npm install -g @testingbot/cli');
    expect(updateNotice('1.5.0', 1_000_000 + 60_000)).toBeUndefined();
    expect(
      updateNotice('1.5.0', 1_000_000 + 25 * 60 * 60 * 1000),
    ).toBeDefined();
  });

  it('persists the newest version between runs', () => {
    recordLatestVersion('1.7.0');
    resetUpdateNotifierForTests();
    expect(readState<{ latestVersion: string }>(STATE)?.latestVersion).toBe(
      '1.7.0',
    );
    expect(updateNotice('1.5.0', 5)).toContain('1.7.0');
  });

  it('never moves the remembered version backwards and ignores junk', () => {
    recordLatestVersion('1.7.0');
    recordLatestVersion('1.6.0');
    recordLatestVersion('<script>');
    expect(readState<{ latestVersion: string }>(STATE)?.latestVersion).toBe(
      '1.7.0',
    );
  });
});

describe('state store', () => {
  it('survives an unwritable location without throwing', () => {
    // A regular file as the config dir: creating a directory under it fails
    // on every platform (a made-up absolute path is writable on Windows).
    const original = process.env.XDG_CONFIG_HOME;
    const blocker = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'tb-state-')),
      'not-a-dir',
    );
    fs.writeFileSync(blocker, '');
    process.env.XDG_CONFIG_HOME = blocker;
    try {
      expect(() => writeState('x.json', { a: 1 })).not.toThrow();
      expect(readState('x.json')).toBeUndefined();
    } finally {
      process.env.XDG_CONFIG_HOME = original;
    }
  });
});
