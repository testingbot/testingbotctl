import {
  link,
  notificationProtocol,
  notifyFinished,
  supportsHyperlinks,
  supportsProgress,
} from '../../src/ui/terminal';

describe('supportsHyperlinks', () => {
  it.each([
    [{ TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.0' }, true],
    [{ TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.0.9' }, false],
    [{ TERM_PROGRAM: 'WezTerm' }, true],
    [{ TERM_PROGRAM: 'ghostty' }, true],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.95.0' }, true],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.60.0' }, false],
    [{ WT_SESSION: 'abc' }, true],
    [{ VTE_VERSION: '7600' }, true],
    [{ TERM_PROGRAM: 'Apple_Terminal' }, false],
    [{}, false],
  ])('%j → %s', (env, expected) => {
    expect(supportsHyperlinks(env as NodeJS.ProcessEnv, true)).toBe(expected);
  });

  it('is off outside an interactive terminal, unless forced', () => {
    expect(supportsHyperlinks({ TERM_PROGRAM: 'WezTerm' }, false)).toBe(false);
    expect(supportsHyperlinks({ FORCE_HYPERLINK: '1' }, false)).toBe(true);
    expect(
      supportsHyperlinks(
        { TERM_PROGRAM: 'WezTerm', FORCE_HYPERLINK: '0' },
        true,
      ),
    ).toBe(false);
  });
});

describe('link', () => {
  it('emits OSC 8 when enabled', () => {
    expect(link('Dashboard', 'https://x.test', true)).toBe(
      '\x1b]8;;https://x.test\x07Dashboard\x1b]8;;\x07',
    );
  });

  it('keeps the URL visible when disabled', () => {
    expect(link('Dashboard', 'https://x.test', false)).toBe(
      'Dashboard (https://x.test)',
    );
    expect(link('https://x.test', 'https://x.test', false)).toBe(
      'https://x.test',
    );
  });
});

describe('notifyFinished', () => {
  const write = jest.fn();
  beforeEach(() => write.mockReset());

  it('stays quiet for short runs', () => {
    expect(
      notifyFinished('done', 59_000, { env: {}, interactive: true, write }),
    ).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('rings the bell on terminals without notifications', () => {
    notifyFinished('done', 61_000, { env: {}, interactive: true, write });
    expect(write).toHaveBeenCalledWith('\x07');
  });

  it('posts an OSC 9 notification in iTerm2 and strips control characters', () => {
    notifyFinished('a\x07b\nc', 61_000, {
      env: { TERM_PROGRAM: 'iTerm.app' },
      interactive: true,
      write,
    });
    expect(write).toHaveBeenCalledWith('\x1b]9;a b c\x07');
  });

  it('uses OSC 99 in kitty', () => {
    expect(notificationProtocol({ KITTY_WINDOW_ID: '1' })).toBe('osc99');
  });

  it('can be turned off, and never fires outside a terminal', () => {
    expect(
      notifyFinished('done', 61_000, {
        env: { TESTINGBOT_NOTIFY: '0' },
        interactive: true,
        write,
      }),
    ).toBe(false);
    expect(
      notifyFinished('done', 61_000, { env: {}, interactive: false, write }),
    ).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('supportsProgress', () => {
  it.each([
    [{ WT_SESSION: '1' }, true],
    [{ ConEmuANSI: 'ON' }, true],
    [{ TERM_PROGRAM: 'ghostty' }, true],
    [{ TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6' }, true],
    [{ TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.0' }, false],
    [{ TERM_PROGRAM: 'Apple_Terminal' }, false],
  ])('%j → %s', (env, expected) => {
    expect(supportsProgress(env as NodeJS.ProcessEnv, true)).toBe(expected);
  });

  it('is never on outside a terminal', () => {
    expect(supportsProgress({ WT_SESSION: '1' }, false)).toBe(false);
  });
});

describe('setProgress', () => {
  it('writes OSC 9;4 and clears it again', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setProgress, clearProgress } = require('../../src/ui/terminal');
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    setProgress('normal', 42.4, true);
    setProgress('error', 150, true);
    setProgress('indeterminate', 10, true);
    setProgress('normal', 50, false);
    clearProgress();
    clearProgress();
    expect(write.mock.calls.map((c) => c[0])).toEqual([
      '\x1b]9;4;1;42\x07',
      '\x1b]9;4;2;100\x07',
      '\x1b]9;4;3;0\x07',
      '\x1b]9;4;0;0\x07',
    ]);
    write.mockRestore();
  });
});
