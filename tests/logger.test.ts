import logger, { redirectLogsToStderr } from '../src/logger';

describe('logger transport', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes info to stdout and error to stderr by default', () => {
    logger.info('hello');
    logger.error('bad');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad'));
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('routes every level to stderr once redirected so stdout stays JSON-only', () => {
    redirectLogsToStderr();
    logger.info('info-line');
    logger.warn('warn-line');
    logger.error('error-line');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((call) => String(call[0]));
    expect(written.some((line) => line.includes('info-line'))).toBe(true);
    expect(written.some((line) => line.includes('warn-line'))).toBe(true);
    expect(written.some((line) => line.includes('error-line'))).toBe(true);
    expect(written.every((line) => line.endsWith('\n'))).toBe(true);
  });
});
