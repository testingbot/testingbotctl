import platform from '../../src/utils/platform';

type TTYMethods = {
  clearLine?: (dir: -1 | 0 | 1) => boolean;
  cursorTo?: (x: number, y?: number) => boolean;
};

function installTTYMethods(): { restore: () => void } {
  const stdout = process.stdout as unknown as TTYMethods;
  const hadClearLine = Object.prototype.hasOwnProperty.call(
    process.stdout,
    'clearLine',
  );
  const hadCursorTo = Object.prototype.hasOwnProperty.call(
    process.stdout,
    'cursorTo',
  );
  const originalClearLine = stdout.clearLine;
  const originalCursorTo = stdout.cursorTo;

  if (!stdout.clearLine) {
    Object.defineProperty(process.stdout, 'clearLine', {
      value: () => true,
      configurable: true,
      writable: true,
    });
  }
  if (!stdout.cursorTo) {
    Object.defineProperty(process.stdout, 'cursorTo', {
      value: () => true,
      configurable: true,
      writable: true,
    });
  }

  return {
    restore: () => {
      if (hadClearLine) {
        stdout.clearLine = originalClearLine;
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).clearLine;
      }
      if (hadCursorTo) {
        stdout.cursorTo = originalCursorTo;
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).cursorTo;
      }
    },
  };
}

function removeTTYMethods(): { restore: () => void } {
  const stdout = process.stdout as unknown as TTYMethods;
  const originalClearLine = stdout.clearLine;
  const originalCursorTo = stdout.cursorTo;
  delete (process.stdout as unknown as Record<string, unknown>).clearLine;
  delete (process.stdout as unknown as Record<string, unknown>).cursorTo;
  return {
    restore: () => {
      if (originalClearLine) {
        Object.defineProperty(process.stdout, 'clearLine', {
          value: originalClearLine,
          configurable: true,
          writable: true,
        });
      }
      if (originalCursorTo) {
        Object.defineProperty(process.stdout, 'cursorTo', {
          value: originalCursorTo,
          configurable: true,
          writable: true,
        });
      }
    },
  };
}

describe('platform.clearLine', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  if (process.platform === 'win32') {
    it('uses stdout.clearLine + cursorTo on Windows when both exist', () => {
      const tty = installTTYMethods();
      try {
        const clearLineSpy = jest
          .spyOn(
            process.stdout as unknown as { clearLine: (d: -1 | 0 | 1) => void },
            'clearLine',
          )
          .mockImplementation(() => true);
        const cursorToSpy = jest
          .spyOn(
            process.stdout as unknown as {
              cursorTo: (x: number, y?: number) => void;
            },
            'cursorTo',
          )
          .mockImplementation(() => true);

        platform.clearLine();

        expect(clearLineSpy).toHaveBeenCalledWith(0);
        expect(cursorToSpy).toHaveBeenCalledWith(0);

        clearLineSpy.mockRestore();
        cursorToSpy.mockRestore();
      } finally {
        tty.restore();
      }
    });

    it('falls back to space-overwrite on Windows when TTY methods are absent', () => {
      const removed = removeTTYMethods();
      try {
        platform.clearLine();
        expect(writeSpy).toHaveBeenCalledWith('\r' + ' '.repeat(120) + '\r');
      } finally {
        removed.restore();
      }
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
