import program from './../src/cli';
import logger from './../src/logger';
import Auth from './../src/auth';
import Espresso from './../src/providers/espresso';
import XCUITest from './../src/providers/xcuitest';
import Maestro from './../src/providers/maestro';
import fs from 'node:fs';
import { JsonOutput } from './../src/utils/json_output';

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

    // The providers are automocked, so give toJsonOutput a realistic shape:
    // the CLI derives the exit code from `outcome`, not from `success` alone.
    const fakeJson =
      (provider: JsonOutput['provider']) =>
      (result: { success: boolean; outcome: JsonOutput['outcome'] }) => ({
        provider,
        outcome: result.outcome,
        success: result.success,
        appId: 1234,
        runs: [],
      });
    Espresso.prototype.toJsonOutput = jest.fn(fakeJson('espresso'));
    Maestro.prototype.toJsonOutput = jest.fn(fakeJson('maestro'));
    XCUITest.prototype.toJsonOutput = jest.fn(fakeJson('xcuitest'));

    jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`process.exit called with code: ${code}`);
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
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

  test('maestro command should accept repeated --other-app flags', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      '--app',
      'app.apk',
      '--other-app',
      'helper.apk',
      '--other-app',
      'mock.apk',
      './flows',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{ otherApps: string[] }>(Maestro);
    expect(opts.otherApps).toEqual(['helper.apk', 'mock.apk']);
  });

  test('maestro command should default otherApps to an empty array', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync(['node', 'cli', 'maestro', 'app.apk', './flows']);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{ otherApps: string[] }>(Maestro);
    expect(opts.otherApps).toEqual([]);
  });

  test('maestro command should reject more than 4 --other-app entries', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--other-app',
      'a.apk',
      '--other-app',
      'b.apk',
      '--other-app',
      'c.apk',
      '--other-app',
      'd.apk',
      '--other-app',
      'e.apk',
    ]);

    expect(mockMaestroRun).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Too many --other-app entries (5). Maximum is 4.',
      ),
    );
    process.exitCode = 0;
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

  test('maestro command should parse --retry into MaestroOptions', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      'app.apk',
      './flows',
      '--device',
      'Pixel 9',
      '--retry',
      '2',
    ]);

    expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    const opts = lastConstructorOptions<{ retry: number }>(Maestro);
    expect(opts.retry).toBe(2);
  });

  test('maestro command should default retry to 0 when --retry omitted', async () => {
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
    const opts = lastConstructorOptions<{ retry: number }>(Maestro);
    expect(opts.retry).toBe(0);
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

  describe('exit codes and JSON output', () => {
    let stdoutSpy: jest.SpyInstance;
    let writeFileSpy: jest.SpyInstance;

    beforeEach(() => {
      mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
      stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      writeFileSpy = jest
        .spyOn(fs.promises, 'writeFile')
        .mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const parseStdoutJson = () => {
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      return JSON.parse(String(stdoutSpy.mock.calls[0][0])) as JsonOutput;
    };

    test.each([
      ['espresso', ['espresso', 'app.apk', 'test.apk']],
      ['maestro', ['maestro', 'app.apk', './flows']],
      ['xcuitest', ['xcuitest', 'app.ipa', 'test.ipa']],
    ])('%s exits 0 when tests pass', async (name, argv) => {
      const run = {
        espresso: mockEspressoRun,
        maestro: mockMaestroRun,
        xcuitest: mockXCUITestRun,
      }[name]!;
      run.mockResolvedValue({ success: true, outcome: 'passed', runs: [] });
      await program.parseAsync(['node', 'cli', ...argv]);
      expect(process.exitCode).toBe(0);
    });

    test.each([
      ['espresso', ['espresso', 'app.apk', 'test.apk']],
      ['maestro', ['maestro', 'app.apk', './flows']],
      ['xcuitest', ['xcuitest', 'app.ipa', 'test.ipa']],
    ])('%s exits 2 when tests fail', async (name, argv) => {
      const run = {
        espresso: mockEspressoRun,
        maestro: mockMaestroRun,
        xcuitest: mockXCUITestRun,
      }[name]!;
      run.mockResolvedValue({ success: false, outcome: 'failed', runs: [] });
      await program.parseAsync(['node', 'cli', ...argv]);
      expect(process.exitCode).toBe(2);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    test('exits 1 when the provider reports a CLI/infrastructure error', async () => {
      mockMaestroRun.mockResolvedValue({
        success: false,
        outcome: 'error',
        error: 'Upload failed',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
      ]);
      expect(process.exitCode).toBe(1);
    });

    test('exits 1 when run() throws', async () => {
      mockMaestroRun.mockRejectedValue(new Error('network down'));
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
      ]);
      expect(process.exitCode).toBe(1);
      expect(logger.error).toHaveBeenCalledWith('Maestro error: network down');
    });

    test('--json prints one JSON document on stdout, forces quiet and exits 2 on failure', async () => {
      mockMaestroRun.mockResolvedValue({
        success: false,
        outcome: 'failed',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--json',
      ]);
      const output = parseStdoutJson();
      expect(output).toMatchObject({
        provider: 'maestro',
        outcome: 'failed',
        success: false,
        appId: 1234,
      });
      expect(lastConstructorOptions<{ quiet: boolean }>(Maestro).quiet).toBe(
        true,
      );
      expect(process.exitCode).toBe(2);
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    test('--json still emits a JSON document when run() throws', async () => {
      mockMaestroRun.mockRejectedValue(new Error('network down'));
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--json',
      ]);
      expect(parseStdoutJson()).toEqual({
        provider: 'maestro',
        outcome: 'error',
        success: false,
        error: 'network down',
        runs: [],
      });
      expect(process.exitCode).toBe(1);
    });

    test('--json-file writes <appId>_testingbot.json and exits 0 on test failure', async () => {
      mockMaestroRun.mockResolvedValue({
        success: false,
        outcome: 'failed',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--json-file',
      ]);
      expect(writeFileSpy).toHaveBeenCalledTimes(1);
      expect(String(writeFileSpy.mock.calls[0][0])).toMatch(
        /1234_testingbot\.json$/,
      );
      expect(JSON.parse(String(writeFileSpy.mock.calls[0][1]))).toMatchObject({
        outcome: 'failed',
      });
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(lastConstructorOptions<{ quiet: boolean }>(Maestro).quiet).toBe(
        true,
      );
      expect(process.exitCode).toBe(0);
    });

    test('--json-file still exits 1 on CLI errors', async () => {
      mockMaestroRun.mockRejectedValue(new Error('network down'));
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--json-file',
      ]);
      expect(writeFileSpy).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(1);
    });

    test('--json-file-name sets the output path', async () => {
      mockEspressoRun.mockResolvedValue({
        success: true,
        outcome: 'passed',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'espresso',
        'app.apk',
        'test.apk',
        '--json-file',
        '--json-file-name',
        'out/results.json',
      ]);
      expect(String(writeFileSpy.mock.calls[0][0])).toMatch(
        /out[\\/]results\.json$/,
      );
      expect(process.exitCode).toBe(0);
    });

    test('--json-file-name without --json-file is rejected before running', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'xcuitest',
        'app.ipa',
        'test.ipa',
        '--json-file-name',
        'out.json',
      ]);
      expect(mockXCUITestRun).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('--json-file-name requires --json-file'),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('status, artifacts and list commands', () => {
    let mockStatus: jest.Mock;
    let mockArtifacts: jest.Mock;
    let mockListProjects: jest.Mock;
    let stdoutSpy: jest.SpyInstance;
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
      mockStatus = jest.fn();
      mockArtifacts = jest.fn();
      mockListProjects = jest.fn();
      Maestro.prototype.status = mockStatus;
      Maestro.prototype.artifacts = mockArtifacts;
      Maestro.prototype.listProjects = mockListProjects;
      stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('status queries the project and exits 0 when it passed', async () => {
      mockStatus.mockResolvedValue({
        success: true,
        outcome: 'passed',
        runs: [],
      });
      await program.parseAsync(['node', 'cli', 'status', '--id', '1234']);
      expect(mockStatus).toHaveBeenCalledWith(1234, { wait: undefined });
      expect(process.exitCode).toBe(0);
    });

    test('status exits 2 when the project failed and 0 while still running', async () => {
      mockStatus.mockResolvedValue({
        success: false,
        outcome: 'failed',
        runs: [],
      });
      await program.parseAsync(['node', 'cli', 'status', '--id', '1234']);
      expect(process.exitCode).toBe(2);

      process.exitCode = 0;
      mockStatus.mockResolvedValue({
        success: false,
        outcome: 'running',
        runs: [],
      });
      await program.parseAsync(['node', 'cli', 'status', '--id', '1234']);
      expect(process.exitCode).toBe(0);
    });

    test('status --wait passes wait and forwards quiet', async () => {
      mockStatus.mockResolvedValue({
        success: true,
        outcome: 'passed',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'status',
        '--id',
        '1234',
        '--wait',
        '--quiet',
      ]);
      expect(mockStatus).toHaveBeenCalledWith(1234, { wait: true });
      expect(lastConstructorOptions<{ quiet: boolean }>(Maestro).quiet).toBe(
        true,
      );
    });

    test('status --json prints the document and moves logs off stdout', async () => {
      mockStatus.mockResolvedValue({
        success: false,
        outcome: 'running',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'status',
        '--id',
        '1234',
        '--json',
      ]);
      expect(JSON.parse(String(stdoutSpy.mock.calls[0][0]))).toMatchObject({
        provider: 'maestro',
        outcome: 'running',
      });
      expect(lastConstructorOptions<{ quiet: boolean }>(Maestro).quiet).toBe(
        true,
      );
      expect(process.exitCode).toBe(0);
    });

    test('status rejects a non-numeric project id with usage help', async () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      await expect(
        program.parseAsync(['node', 'cli', 'status', '--id', 'abc']),
      ).rejects.toThrow('process.exit called with code: 1');
      expect(mockStatus).not.toHaveBeenCalled();
      expect(stderrSpy.mock.calls.map((c) => String(c[0])).join('')).toContain(
        'expected a positive integer',
      );
    });

    test('status requires --id', async () => {
      await expect(
        program.parseAsync(['node', 'cli', 'status']),
      ).rejects.toThrow('process.exit called with code: 1');
      expect(mockStatus).not.toHaveBeenCalled();
    });

    test('status exits 1 without credentials', async () => {
      mockGetCredentials.mockResolvedValue(null);
      await program.parseAsync(['node', 'cli', 'status', '--id', '1234']);
      expect(mockStatus).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('No TestingBot credentials found'),
      );
      expect(process.exitCode).toBe(1);
    });

    test('artifacts forwards report and artifact options', async () => {
      mockArtifacts.mockResolvedValue({
        success: true,
        outcome: 'passed',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'artifacts',
        '--id',
        '1234',
        '--report',
        'JUNIT',
        '--report-output-dir',
        './reports',
        '--download-artifacts',
        'failed',
        '--artifacts-output-dir',
        './out',
      ]);
      expect(mockArtifacts).toHaveBeenCalledWith(1234);
      const opts = lastConstructorOptions<{
        report?: string;
        reportOutputDir?: string;
        downloadArtifacts?: string;
        artifactsOutputDir?: string;
      }>(Maestro);
      expect(opts.report).toBe('junit');
      expect(opts.reportOutputDir).toBe('./reports');
      expect(opts.downloadArtifacts).toBe('failed');
      expect(opts.artifactsOutputDir).toBe('./out');
      expect(process.exitCode).toBe(0);
    });

    test('artifacts defaults --download-artifacts to all and exits 1 on error', async () => {
      mockArtifacts.mockResolvedValue({
        success: false,
        outcome: 'error',
        error: 'still running',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'artifacts',
        '--id',
        '1234',
        '--download-artifacts',
      ]);
      expect(
        lastConstructorOptions<{ downloadArtifacts?: string }>(Maestro)
          .downloadArtifacts,
      ).toBe('all');
      expect(process.exitCode).toBe(1);
    });

    test('list prints a table and passes pagination through', async () => {
      mockListProjects.mockResolvedValue({
        data: [
          {
            id: 42,
            name: 'nightly',
            created_at: '2026-09-01T10:00:00Z',
            updated_at: '2026-09-01T10:05:00Z',
            completed: true,
            app: { bundle_id: 'com.example', app_version: '1.0' },
            flows: [{ id: 1, name: 'login' }],
            runs: [7, 8],
          },
        ],
        meta: { offset: 5, count: 1, total: 20 },
      });
      await program.parseAsync([
        'node',
        'cli',
        'list',
        '--count',
        '1',
        '--offset',
        '5',
      ]);
      expect(mockListProjects).toHaveBeenCalledWith({ count: 1, offset: 5 });
      const printed = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('42');
      expect(printed).toContain('nightly');
      expect(printed).toContain('completed');
      expect(printed).toContain('Showing 6-6 of 20');
      expect(lastConstructorOptions<{ quiet: boolean }>(Maestro).quiet).toBe(
        true,
      );
      expect(process.exitCode).toBe(0);
    });

    test('list --json emits projects with dashboard urls', async () => {
      mockListProjects.mockResolvedValue({
        data: [
          {
            id: 42,
            name: 'nightly',
            created_at: '2026-09-01T10:00:00Z',
            updated_at: '2026-09-01T10:05:00Z',
            completed: false,
            flows: [],
            runs: [],
          },
        ],
        meta: { offset: 0, count: 10, total: 1 },
      });
      await program.parseAsync(['node', 'cli', 'list', '--json']);
      expect(mockListProjects).toHaveBeenCalledWith({
        count: undefined,
        offset: undefined,
      });
      const output = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
      expect(output).toEqual({
        provider: 'maestro',
        meta: { offset: 0, count: 10, total: 1 },
        projects: [
          {
            id: 42,
            name: 'nightly',
            completed: false,
            createdAt: '2026-09-01T10:00:00Z',
            runs: [],
            flows: [],
            url: 'https://testingbot.com/members/maestro/42',
          },
        ],
      });
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });

    test('list exits 1 and emits an error document when the API fails', async () => {
      mockListProjects.mockRejectedValue(new Error('boom'));
      await program.parseAsync(['node', 'cli', 'list', '--json']);
      expect(JSON.parse(String(stdoutSpy.mock.calls[0][0]))).toMatchObject({
        outcome: 'error',
        error: 'boom',
      });
      expect(process.exitCode).toBe(1);
    });
  });

  describe('upload command and --app-binary-id', () => {
    let mockUploadOnly: jest.Mock;
    let stdoutSpy: jest.SpyInstance;

    beforeEach(() => {
      mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
      mockUploadOnly = jest.fn();
      Maestro.prototype.uploadOnly = mockUploadOnly;
      stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('upload stores the app and prints the reusable project id', async () => {
      mockUploadOnly.mockResolvedValue({ success: true, appId: 4321 });
      await program.parseAsync(['node', 'cli', 'upload', 'app.apk']);
      expect(mockUploadOnly).toHaveBeenCalledTimes(1);
      const opts = lastConstructorOptions<{
        app: string;
        flows: string[];
        ignoreChecksumCheck: boolean;
      }>(Maestro);
      expect(opts.app).toBe('app.apk');
      expect(opts.flows).toEqual([]);
      expect(opts.ignoreChecksumCheck).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Project ID: 4321'),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('--app-binary-id 4321'),
      );
      expect(process.exitCode).toBe(0);
    });

    test('upload --json emits the project id and url', async () => {
      mockUploadOnly.mockResolvedValue({ success: true, appId: 4321 });
      await program.parseAsync([
        'node',
        'cli',
        'upload',
        'app.apk',
        '--ignore-checksum-check',
        '--json',
      ]);
      expect(
        lastConstructorOptions<{
          ignoreChecksumCheck: boolean;
          quiet: boolean;
        }>(Maestro),
      ).toMatchObject({ ignoreChecksumCheck: true, quiet: true });
      expect(JSON.parse(String(stdoutSpy.mock.calls[0][0]))).toEqual({
        provider: 'maestro',
        appId: 4321,
        file: 'app.apk',
        url: 'https://testingbot.com/members/maestro/4321',
      });
      expect(process.exitCode).toBe(0);
    });

    test('upload exits 1 when the provider reports a failure', async () => {
      mockUploadOnly.mockResolvedValue({ success: false, error: 'bad app' });
      await program.parseAsync(['node', 'cli', 'upload', 'app.apk', '--json']);
      expect(JSON.parse(String(stdoutSpy.mock.calls[0][0]))).toMatchObject({
        outcome: 'error',
        error: 'bad app',
      });
      expect(process.exitCode).toBe(1);
    });

    test('upload requires an app file argument', async () => {
      await expect(
        program.parseAsync(['node', 'cli', 'upload']),
      ).rejects.toThrow('process.exit called with code: 1');
      expect(mockUploadOnly).not.toHaveBeenCalled();
    });

    test('maestro --app-binary-id treats every positional as a flow', async () => {
      mockMaestroRun.mockResolvedValue({
        success: true,
        outcome: 'passed',
        runs: [],
      });
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        '--app-binary-id',
        '4321',
        './flows',
        './more',
      ]);
      const opts = lastConstructorOptions<{
        app: string;
        flows: string[];
        appBinaryId?: number;
      }>(Maestro);
      expect(opts.appBinaryId).toBe(4321);
      expect(opts.app).toBe('');
      expect(opts.flows).toEqual(['./flows', './more']);
      expect(mockMaestroRun).toHaveBeenCalledTimes(1);
    });

    test('maestro --app-binary-id still requires flows', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        '--app-binary-id',
        '4321',
      ]);
      expect(mockMaestroRun).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('<flows...>'),
      );
      expect(process.exitCode).toBe(1);
    });

    test('maestro --app-binary-id rejects a non-numeric id', async () => {
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      await expect(
        program.parseAsync([
          'node',
          'cli',
          'maestro',
          '--app-binary-id',
          'abc',
          './flows',
        ]),
      ).rejects.toThrow('process.exit called with code: 1');
      expect(mockMaestroRun).not.toHaveBeenCalled();
    });
  });

  describe('drop-in flags: metadata, exclude-flows, Maestro Cloud aliases', () => {
    beforeEach(() => {
      mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
      mockMaestroRun.mockResolvedValue({
        success: true,
        outcome: 'passed',
        runs: [],
      });
    });

    type Opts = {
      metadata?: Record<string, unknown>;
      excludeFlows?: string[];
      app: string;
      flows: string[];
      device?: string;
      platformName?: string;
      version?: string;
      report?: string;
      reportOutputDir?: string;
      name?: string;
    };

    test('--branch, --pr-url and --metadata land in run metadata', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--branch',
        'main',
        '--pr-url',
        'https://github.com/o/r/pull/7',
        '--commit-sha',
        'abc',
        '-m',
        'team=mobile',
        '--metadata',
        'env=staging=eu',
      ]);
      expect(lastConstructorOptions<Opts>(Maestro).metadata).toEqual({
        commitSha: 'abc',
        pullRequestUrl: 'https://github.com/o/r/pull/7',
        branch: 'main',
        custom: { team: 'mobile', env: 'staging=eu' },
      });
    });

    test('metadata is omitted entirely when no CI flag is given', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
      ]);
      expect(lastConstructorOptions<Opts>(Maestro).metadata).toBeUndefined();
    });

    test('--metadata without KEY=VALUE is rejected', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '-m',
        'novalue',
      ]);
      expect(mockMaestroRun).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid --metadata entry "novalue"'),
      );
      expect(process.exitCode).toBe(1);
    });

    test('--exclude-flows accepts comma-separated and repeated values', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--exclude-flows',
        'a.yaml, ./wip',
        '--exclude-flows',
        '**/slow-*.yaml',
      ]);
      expect(lastConstructorOptions<Opts>(Maestro).excludeFlows).toEqual([
        'a.yaml',
        './wip',
        '**/slow-*.yaml',
      ]);
    });

    test('--report allure is accepted', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--report',
        'ALLURE',
        '--report-output-dir',
        './reports',
      ]);
      expect(lastConstructorOptions<Opts>(Maestro).report).toBe('allure');
    });

    test('a maestro cloud command line runs unchanged via hidden aliases', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        '--apiKey',
        'k',
        '--app-file',
        'app.zip',
        '--flows',
        './flows,./smoke',
        '--device-model',
        'iPhone-17-Pro',
        '--device-os',
        'iOS-18-2',
        '--format',
        'JUNIT',
        '--output',
        'out/report.xml',
        '--test-suite-name',
        'nightly',
      ]);
      expect(mockGetCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'k' }),
      );
      const opts = lastConstructorOptions<Opts>(Maestro);
      expect(opts.app).toBe('app.zip');
      expect(opts.flows).toEqual(['./flows', './smoke']);
      expect(opts.device).toBe('iPhone 17 Pro');
      expect(opts.platformName).toBe('iOS');
      expect(opts.version).toBe('18.2');
      expect(opts.report).toBe('junit');
      expect(opts.reportOutputDir).toMatch(/[\\/]out$/);
      expect(opts.name).toBe('nightly');
    });

    test('--device-os android-34 maps the API level to Android 14', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--device-os',
        'android-34',
      ]);
      const opts = lastConstructorOptions<Opts>(Maestro);
      expect(opts.platformName).toBe('Android');
      expect(opts.version).toBe('14');
    });

    test('canonical flags win over aliases', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        '--app',
        'real.apk',
        '--app-file',
        'alias.apk',
        './flows',
        '--device',
        'Pixel 9',
        '--device-model',
        'pixel_7',
      ]);
      const opts = lastConstructorOptions<Opts>(Maestro);
      expect(opts.app).toBe('real.apk');
      expect(opts.device).toBe('Pixel 9');
    });

    test('--format NOOP means no report; other values are rejected', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--format',
        'NOOP',
      ]);
      expect(lastConstructorOptions<Opts>(Maestro).report).toBeUndefined();

      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--format',
        'PDF',
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid --format "PDF"'),
      );
      expect(process.exitCode).toBe(1);
    });

    test('aliases are hidden from help', () => {
      const maestroCmd = program.commands.find((c) => c.name() === 'maestro')!;
      const help = maestroCmd.helpInformation();
      expect(help).not.toContain('--app-file');
      expect(help).not.toContain('--device-os');
      expect(help).toContain('--exclude-flows');
      expect(help).toContain('--metadata');
    });
  });

  describe('--device-matrix', () => {
    beforeEach(() => {
      mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });
      mockMaestroRun.mockResolvedValue({
        success: true,
        outcome: 'passed',
        runs: [],
      });
    });

    type Opts = { deviceMatrix?: unknown; device?: string };

    test('parses comma-separated and repeated cells with version and real flag', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--device-matrix',
        'Pixel 9:14, Samsung Galaxy S24:14:real',
        '--device-matrix',
        'Pixel 8',
        '--device-matrix',
        'Pixel 7:REAL',
      ]);
      expect(lastConstructorOptions<Opts>(Maestro).deviceMatrix).toEqual([
        { device: 'Pixel 9', version: '14' },
        { device: 'Samsung Galaxy S24', version: '14', realDevice: true },
        { device: 'Pixel 8' },
        { device: 'Pixel 7', realDevice: true },
      ]);
      expect(lastConstructorOptions<Opts>(Maestro).device).toBeUndefined();
    });

    test('is undefined when the flag is absent', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
      ]);
      expect(
        lastConstructorOptions<Opts>(Maestro).deviceMatrix,
      ).toBeUndefined();
    });

    test('rejects malformed cells', async () => {
      await program.parseAsync([
        'node',
        'cli',
        'maestro',
        'app.apk',
        './flows',
        '--device-matrix',
        'Pixel 9:14:extra:junk',
      ]);
      expect(mockMaestroRun).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Invalid --device-matrix cell "Pixel 9:14:extra:junk"',
        ),
      );
      expect(process.exitCode).toBe(1);
    });
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
