import platform from '../../src/utils/platform';

describe('platform.clearLine', () => {
  let writeSpy: jest.SpyInstance;
  let clearLineSpy: jest.SpyInstance | null;
  let cursorToSpy: jest.SpyInstance | null;

  beforeEach(() => {
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    clearLineSpy = null;
    cursorToSpy = null;
  });

  afterEach(() => {
    writeSpy.mockRestore();
    clearLineSpy?.mockRestore();
    cursorToSpy?.mockRestore();
  });

  if (process.platform === 'win32') {
    it('uses stdout.clearLine + cursorTo on Windows when available', () => {
      clearLineSpy = jest
        .spyOn(process.stdout, 'clearLine')
        .mockImplementation(() => true);
      cursorToSpy = jest
        .spyOn(process.stdout, 'cursorTo')
        .mockImplementation(() => true);

      platform.clearLine();

      expect(clearLineSpy).toHaveBeenCalledWith(0);
      expect(cursorToSpy).toHaveBeenCalledWith(0);
    });
  } else {
    it('writes the ANSI clear-line escape sequence on unix', () => {
      platform.clearLine();
      expect(writeSpy).toHaveBeenCalledWith('\r\x1b[K');
    });
  }
});

describe('platform.setupSignalHandlers / removeSignalHandlers', () => {
  let onSpy: jest.SpyInstance;
  let removeSpy: jest.SpyInstance;

  beforeEach(() => {
    onSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
    removeSpy = jest
      .spyOn(process, 'removeListener')
      .mockImplementation(() => process);
  });

  afterEach(() => {
    onSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('registers SIGINT and (on unix) SIGTERM', () => {
    const handler = jest.fn();
    platform.setupSignalHandlers(handler);

    const signals = onSpy.mock.calls.map((call) => call[0]);
    expect(signals).toContain('SIGINT');
    if (process.platform !== 'win32') {
      expect(signals).toContain('SIGTERM');
    } else {
      expect(signals).not.toContain('SIGTERM');
    }
  });

  it('removes SIGINT and (on unix) SIGTERM listeners', () => {
    const handler = jest.fn();
    platform.removeSignalHandlers(handler);

    const signals = removeSpy.mock.calls.map((call) => call[0]);
    expect(signals).toContain('SIGINT');
    if (process.platform !== 'win32') {
      expect(signals).toContain('SIGTERM');
    } else {
      expect(signals).not.toContain('SIGTERM');
    }
  });
});
