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

function lastConstructorOptions<T>(ctor: unknown): T {
  const calls = (ctor as unknown as jest.Mock).mock.calls;
  return calls[calls.length - 1][1] as T;
}

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
    const opts = lastConstructorOptions<{
      app: string;
      testApp: string;
      device?: string;
    }>(Espresso);
    expect(opts.app).toBe('app.apk');
    expect(opts.testApp).toBe('test-app.apk');
    expect(opts.device).toBe('Pixel 6');
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
    const opts = lastConstructorOptions<{
      app: string;
      testApp: string;
      device?: string;
    }>(Espresso);
    expect(opts.app).toBe('app.apk');
    expect(opts.testApp).toBe('test-app.apk');
    expect(opts.device).toBe('Pixel 6');
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
    const opts = lastConstructorOptions<{
      class?: string[];
      annotation?: string[];
      size?: string[];
    }>(Espresso);
    expect(opts.class).toEqual([
      'com.example.LoginTest',
      'com.example.HomeTest',
    ]);
    expect(opts.annotation).toEqual(['com.example.SmokeTest']);
    expect(opts.size).toEqual(['small', 'medium']);
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
      '--geo-country-code',
      'DE',
      '--throttle-network',
      '3G',
      '--language',
      'de',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      geoCountryCode?: string;
      throttleNetwork?: string;
      language?: string;
    }>(Espresso);
    expect(opts.geoCountryCode).toBe('DE');
    expect(opts.throttleNetwork).toBe('3G');
    expect(opts.language).toBe('de');
  });

  test('espresso command should accept tunnel options', async () => {
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
      '--tunnel',
      '--tunnel-identifier',
      'my-tunnel',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      tunnel: boolean;
      tunnelIdentifier?: string;
    }>(Espresso);
    expect(opts.tunnel).toBe(true);
    expect(opts.tunnelIdentifier).toBe('my-tunnel');
  });

  test('espresso command should accept -t shorthand for tunnel', async () => {
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
      '-t',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{ tunnel: boolean }>(Espresso);
    expect(opts.tunnel).toBe(true);
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
    const opts = lastConstructorOptions<{
      realDevice: boolean;
      locale?: string;
    }>(Espresso);
    expect(opts.realDevice).toBe(true);
    expect(opts.locale).toBe('en_US');
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
    const opts = lastConstructorOptions<{ async: boolean; quiet: boolean }>(
      Espresso,
    );
    expect(opts.async).toBe(true);
    expect(opts.quiet).toBe(true);
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
    const opts = lastConstructorOptions<{
      app: string;
      flows: string[];
      device?: string;
    }>(Maestro);
    expect(opts.app).toBe('app.apk');
    expect(opts.flows).toEqual(['./flows']);
    expect(opts.device).toBe('device-1');
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
    const opts = lastConstructorOptions<{
      app: string;
      flows: string[];
      device?: string;
    }>(Maestro);
    expect(opts.app).toBe('app.apk');
    expect(opts.flows).toEqual(['./flows']);
    expect(opts.device).toBe('device-1');
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
    const opts = lastConstructorOptions<{ flows: string[] }>(Maestro);
    expect(opts.flows).toEqual(['./flows1', './flows2', './flows3']);
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
    const opts = lastConstructorOptions<{
      includeTags?: string[];
      excludeTags?: string[];
    }>(Maestro);
    expect(opts.includeTags).toEqual(['smoke', 'regression']);
    expect(opts.excludeTags).toEqual(['flaky']);
  });

  test('maestro command should accept --groups (parsed into array, surfaces in capabilities)', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'device-1',
      '--groups',
      'smoke, critical , ,regression',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{ groups?: string[] }>(Maestro);
    // Empty entries from "a, ,b" and surrounding whitespace are stripped.
    expect(opts.groups).toEqual(['smoke', 'critical', 'regression']);
  });

  test('maestro command should work without --device (optional)', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync(['node', 'cli', 'maestro', 'app.apk', './flows']);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      app: string;
      flows: string[];
      device?: string;
    }>(Maestro);
    expect(opts.app).toBe('app.apk');
    expect(opts.flows).toEqual(['./flows']);
    expect(opts.device).toBeUndefined();
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
    const opts = lastConstructorOptions<{
      device?: string;
      realDevice: boolean;
    }>(Maestro);
    expect(opts.device).toBe('Pixel 9');
    expect(opts.realDevice).toBe(true);
  });

  test('maestro command should accept --google-play flag', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'Pixel 9',
      '--google-play',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      device?: string;
      googlePlayStore?: boolean;
    }>(Maestro);
    expect(opts.device).toBe('Pixel 9');
    expect(opts.googlePlayStore).toBe(true);
  });

  test('maestro command should default googlePlayStore to false when --google-play omitted', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'Pixel 9',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      googlePlayStore: boolean;
    }>(Maestro);
    expect(opts.googlePlayStore).toBe(false);
  });

  test('espresso command should accept metadata options', async () => {
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
      '--commit-sha',
      'abc123def456',
      '--pull-request-id',
      '42',
      '--repo-name',
      'my-app',
      '--repo-owner',
      'my-org',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      metadata?: {
        commitSha?: string;
        pullRequestId?: string;
        repoName?: string;
        repoOwner?: string;
      };
    }>(Espresso);
    expect(opts.metadata).toEqual({
      commitSha: 'abc123def456',
      pullRequestId: '42',
      repoName: 'my-app',
      repoOwner: 'my-org',
    });
  });

  test('maestro command should accept metadata options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'Pixel 6',
      '--commit-sha',
      'abc123def456',
      '--pull-request-id',
      '42',
      '--repo-name',
      'my-app',
      '--repo-owner',
      'my-org',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      metadata?: {
        commitSha?: string;
        pullRequestId?: string;
        repoName?: string;
        repoOwner?: string;
      };
    }>(Maestro);
    expect(opts.metadata).toEqual({
      commitSha: 'abc123def456',
      pullRequestId: '42',
      repoName: 'my-app',
      repoOwner: 'my-org',
    });
  });

  test('xcuitest command should accept metadata options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'xcuitest',
      '--app',
      'app.ipa',
      '--test-app',
      'test-app.zip',
      '--device',
      'iPhone 15',
      '--commit-sha',
      'abc123def456',
      '--pull-request-id',
      '42',
      '--repo-name',
      'my-ios-app',
      '--repo-owner',
      'my-org',
    ]);

    expect(mockXCUITestRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{
      metadata?: {
        commitSha?: string;
        pullRequestId?: string;
        repoName?: string;
        repoOwner?: string;
      };
    }>(XCUITest);
    expect(opts.metadata).toEqual({
      commitSha: 'abc123def456',
      pullRequestId: '42',
      repoName: 'my-ios-app',
      repoOwner: 'my-org',
    });
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
    const opts = lastConstructorOptions<{
      app: string;
      testApp: string;
      device?: string;
    }>(XCUITest);
    expect(opts.app).toBe('app.ipa');
    expect(opts.testApp).toBe('test-app.ipa');
    expect(opts.device).toBe('device-1');
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
      'Espresso error: No TestingBot credentials found. Please authenticate using one of these methods:\n' +
        '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
        '  2. Use --api-key and --api-secret options\n' +
        '  3. Set TB_KEY and TB_SECRET environment variables\n' +
        '  4. Create ~/.testingbot file with content: key:secret',
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
      'Maestro error: No TestingBot credentials found. Please authenticate using one of these methods:\n' +
        '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
        '  2. Use --api-key and --api-secret options\n' +
        '  3. Set TB_KEY and TB_SECRET environment variables\n' +
        '  4. Create ~/.testingbot file with content: key:secret',
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
      'XCUITest error: No TestingBot credentials found. Please authenticate using one of these methods:\n' +
        '  1. Run "testingbot login" to authenticate via browser (recommended)\n' +
        '  2. Use --api-key and --api-secret options\n' +
        '  3. Set TB_KEY and TB_SECRET environment variables\n' +
        '  4. Create ~/.testingbot file with content: key:secret',
    );
  });

  test('espresso command should throw explicit error when app arg is missing', async () => {
    const mockError = jest.fn();
    logger.error = mockError;

    await program.parseAsync(['node', 'cli', 'espresso']);

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Missing required argument:'),
    );
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('--app'));
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('--test-app'),
    );
    expect(Espresso.prototype.run).not.toHaveBeenCalled();
  });

  test('maestro command should throw explicit error when app arg is missing', async () => {
    const mockError = jest.fn();
    logger.error = mockError;

    await program.parseAsync(['node', 'cli', 'maestro']);

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Missing required argument:'),
    );
    expect(Maestro.prototype.run).not.toHaveBeenCalled();
  });

  test('xcuitest command should throw explicit error when app arg is missing', async () => {
    const mockError = jest.fn();
    logger.error = mockError;

    await program.parseAsync(['node', 'cli', 'xcuitest']);

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Missing required argument:'),
    );
    expect(XCUITest.prototype.run).not.toHaveBeenCalled();
  });

  test('espresso command should not construct provider when credentials are missing', async () => {
    mockGetCredentials.mockResolvedValue(null);
    const mockError = jest.fn();
    logger.error = mockError;

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      'app.apk',
      'test-app.apk',
    ]);

    // Preflight: run() must not fire if credentials are unresolved,
    // even though all required args are present.
    expect(Espresso.prototype.run).not.toHaveBeenCalled();
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
