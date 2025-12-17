import program from './../src/cli';
import logger from './../src/logger';
import Auth from './../src/auth';
import Espresso from './../src/providers/espresso';
import XCUITest from './../src/providers/xcuitest';
import Maestro from './../src/providers/maestro';

jest.mock('./../src/logger');
jest.mock('./../src/auth');
jest.mock('./../src/providers/espresso');
jest.mock('./../src/providers/xcuitest');
jest.mock('./../src/providers/maestro');

const mockGetCredentials = Auth.getCredentials as jest.Mock;

describe('TestingBotCTL CLI', () => {
  let mockEspressoRun: jest.Mock;
  let mockMaestroRun: jest.Mock;
  let mockXCUITestRun: jest.Mock;

  beforeEach(() => {
    mockEspressoRun = jest.fn();
    Espresso.prototype.run = mockEspressoRun;

    mockMaestroRun = jest.fn();
    Maestro.prototype.run = mockMaestroRun;

    mockXCUITestRun = jest.fn();
    XCUITest.prototype.run = mockXCUITestRun;

    jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit called with code: ${code}`);
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('espresso command should call espresso.run() with valid options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
    mockEspressoRun.mockResolvedValue({ success: true, runs: [] });

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      '--app',
      'app.apk',
      '--device',
      'Pixel 6',
      '--test-app',
      'test-app.apk',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
    expect(mockEspressoRun).toHaveBeenCalledWith();
  });

  test('espresso command should accept positional arguments', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
    mockEspressoRun.mockResolvedValue({ success: true, runs: [] });

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      'app.apk',
      'test-app.apk',
      '--device',
      'Pixel 6',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
  });

  test('espresso command should accept filtering options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
    mockEspressoRun.mockResolvedValue({ success: true, runs: [] });

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      '--app',
      'app.apk',
      '--test-app',
      'test-app.apk',
      '--device',
      'Pixel 6',
      '--class',
      'com.example.LoginTest,com.example.HomeTest',
      '--annotation',
      'com.example.SmokeTest',
      '--size',
      'small,medium',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
  });

  test('espresso command should accept geolocation and network options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
    mockEspressoRun.mockResolvedValue({ success: true, runs: [] });

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      '--app',
      'app.apk',
      '--test-app',
      'test-app.apk',
      '--device',
      'Pixel 6',
      '--geo-location',
      'DE',
      '--throttle-network',
      '3G',
      '--language',
      'de',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
  });

  test('espresso command should accept device configuration options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
    mockEspressoRun.mockResolvedValue({ success: true, runs: [] });

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      '--app',
      'app.apk',
      '--test-app',
      'test-app.apk',
      '--device',
      'Pixel 6',
      '--platform-version',
      '14',
      '--real-device',
      '--locale',
      'en_US',
      '--timezone',
      'America/New_York',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
  });

  test('espresso command should accept async and quiet modes', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
    mockEspressoRun.mockResolvedValue({ success: true, runs: [] });

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      '--app',
      'app.apk',
      '--test-app',
      'test-app.apk',
      '--device',
      'Pixel 6',
      '--async',
      '--quiet',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
  });

  test('maestro command should call maestro.run() with positional arguments', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'device-1',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
  });

  test('maestro command should call maestro.run() with named options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      '--app',
      'app.apk',
      '--device',
      'device-1',
      './flows',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
  });

  test('maestro command should accept multiple flow paths', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows1',
      './flows2',
      './flows3',
      '--device',
      'device-1',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
  });

  test('maestro command should accept include-tags and exclude-tags', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'device-1',
      '--include-tags',
      'smoke,regression',
      '--exclude-tags',
      'flaky',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
  });

  test('maestro command should work without --device (optional)', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync(['node', 'cli', 'maestro', 'app.apk', './flows']);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
  });

  test('maestro command should accept --real-device flag', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'Pixel 9',
      '--real-device',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
  });

  test('xcuitest command should call xcuitest.run() with valid options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'xcuitest',
      '--app',
      'app.ipa',
      '--device',
      'device-1',
      '--test-app',
      'test-app.ipa',
    ]);

    expect(mockXCUITestRun).toHaveBeenCalledTimes(1);
  });

  test('espresso command should handle missing credentials', async () => {
    mockGetCredentials.mockResolvedValue(null);

    const mockError = jest.fn();
    logger.error = mockError;

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      '--app',
      'app.apk',
      '--device',
      'Pixel 6',
      '--test-app',
      'test-app.apk',
    ]);

    expect(mockError).toHaveBeenCalledWith(
      'Espresso error: Please specify credentials via --api-key/--api-secret, TB_KEY/TB_SECRET environment variables, or ~/.testingbot file',
    );
  });

  test('maestro command should handle missing credentials', async () => {
    mockGetCredentials.mockResolvedValue(null);

    const mockError = jest.fn();
    logger.error = mockError;

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'device-1',
    ]);

    expect(mockError).toHaveBeenCalledWith(
      'Maestro error: Please specify credentials via --api-key/--api-secret, TB_KEY/TB_SECRET environment variables, or ~/.testingbot file',
    );
  });

  test('xcuitest command should handle missing credentials', async () => {
    mockGetCredentials.mockResolvedValue(null);

    const mockError = jest.fn();
    logger.error = mockError;

    await program.parseAsync([
      'node',
      'cli',
      'xcuitest',
      '--app',
      'app.ipa',
      '--device',
      'device-1',
      '--test-app',
      'test-app.ipa',
    ]);

    expect(mockError).toHaveBeenCalledWith(
      'XCUITest error: Please specify credentials via --api-key/--api-secret, TB_KEY/TB_SECRET environment variables, or ~/.testingbot file',
    );
  });

  test('unknown command should show help', async () => {
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit called with code: ${code}`);
      });

    await expect(
      program.parseAsync(['node', 'cli', 'unknown']),
    ).rejects.toThrow('process.exit called with code: 1');

    exitSpy.mockRestore();
  });
});
