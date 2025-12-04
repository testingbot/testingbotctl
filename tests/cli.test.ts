import program from './../src/cli';
import logger from './../src/logger';
import auth from './../src/auth';
import Espresso from './../src/providers/espresso';
import XCUITest from './../src/providers/xcuitest';
import Maestro from './../src/providers/maestro';

jest.mock('./../src/logger');
jest.mock('./../src/auth');
jest.mock('./../src/providers/espresso');
jest.mock('./../src/providers/xcuitest');
jest.mock('./../src/providers/maestro');

const mockGetCredentials = auth.getCredentials as jest.Mock;

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

    await program.parseAsync([
      'node',
      'cli',
      'espresso',
      '--app',
      'app.apk',
      '--device',
      'device-1',
      '--emulator',
      'emulator-1',
      '--test-app',
      'test-app.apk',
    ]);

    expect(mockEspressoRun).toHaveBeenCalledTimes(1);
    expect(mockEspressoRun).toHaveBeenCalledWith();
  });

  test('maestro command should call maestro.run() with valid options', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'test-api-key' });

    await program.parseAsync([
      'node',
      'cli',
      'maestro',
      '--app',
      'app.apk',
      '--device',
      'device-1',
      '--test-app',
      'test-app.apk',
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
      'device-1',
      '--emulator',
      'emulator-1',
      '--test-app',
      'test-app.apk',
    ]);

    expect(mockError).toHaveBeenCalledWith(
      'Espresso error: Please specify credentials',
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
      '--app',
      'app.apk',
      '--device',
      'device-1',
      '--test-app',
      'test-app.apk',
    ]);

    expect(mockError).toHaveBeenCalledWith(
      'Maestro error: Please specify credentials',
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
      'XCUITest error: Please specify credentials',
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
