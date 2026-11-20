import fs from 'node:fs';
import { bannerMode, buildBigText, printBanner } from '../../src/ui/banner';
import { stateDir } from '../../src/utils/state';
import utils from '../../src/utils';

describe('banner', () => {
  let out: string[];
  beforeEach(() => {
    fs.rmSync(stateDir(), { recursive: true, force: true });
    out = [];
    jest.spyOn(console, 'log').mockImplementation((s = '') => {
      out.push(String(s));
    });
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(utils, 'isInteractive').mockReturnValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('spells TESTINGBOT in three rows of equal width', () => {
    const rows = buildBigText();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => Array.from(r).length)).size).toBe(1);
  });

  it('shows the full banner once per version, then a one-line header', async () => {
    expect(bannerMode({}, '9.9.9')).toBe('full');
    await printBanner(['maestro']);
    expect(out.join('\n')).toContain('Espresso · XCUITest · Maestro');
    out = [];
    await printBanner(['maestro']);
    expect(out[0]).toContain('▌TestingBot');
    expect(out.join('\n')).not.toContain('Espresso · XCUITest · Maestro');
  });

  it('can be forced and turned off', () => {
    expect(bannerMode({ TESTINGBOT_BANNER: 'off' })).toBe('off');
    expect(bannerMode({ TESTINGBOT_BANNER: 'FULL' })).toBe('full');
  });

  it('stays out of help, JSON, quiet, completion and non-interactive output', async () => {
    for (const argv of [
      ['--help'],
      ['maestro', '--json'],
      ['maestro', '-q'],
      ['completion', 'zsh'],
    ]) {
      await printBanner(argv);
    }
    (utils.isInteractive as jest.Mock).mockReturnValue(false);
    await printBanner(['maestro']);
    expect(out).toEqual([]);
  });
});
