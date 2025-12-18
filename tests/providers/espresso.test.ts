import Espresso, { EspressoSocketMessage } from '../../src/providers/espresso';
import EspressoOptions from '../../src/models/espresso_options';
import TestingBotError from '../../src/models/testingbot_error';
import fs from 'node:fs';
import axios from 'axios';
import { Readable } from 'node:stream';
import Credentials from '../../src/models/credentials';

jest.mock('axios');
jest.mock('../../src/utils', () => ({
  __esModule: true,
  default: {
    getUserAgent: jest.fn().mockReturnValue('TestingBot-CTL-test'),
    getCurrentVersion: jest.fn().mockReturnValue('1.0.0'),
    compareVersions: jest.fn().mockReturnValue(0),
    checkForUpdate: jest.fn(),
  },
}));

// Mock socket.io-client
const mockSocket = {
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    access: jest.fn(),
    stat: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
  },
}));

describe('Espresso', () => {
  let espresso: Espresso;
  const mockCredentials = new Credentials('testUser', 'testKey');

  const mockOptions = new EspressoOptions(
    'path/to/app.apk',
    'path/to/testApp.apk',
    'Pixel 6',
  );

  beforeEach(() => {
    espresso = new Espresso(mockCredentials, mockOptions);
    jest.clearAllMocks();
  });

  describe('Validation', () => {
    it('should pass validation when app and testApp are provided', async () => {
      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(espresso['validate']()).resolves.toBe(true);
    });

    it('should throw an error when app is missing', async () => {
      const optionsWithoutApp = new EspressoOptions(
        undefined as unknown as string,
        'path/to/testApp.apk',
        'Pixel 6',
      );
      const espressoWithoutApp = new Espresso(
        mockCredentials,
        optionsWithoutApp,
      );

      await expect(espressoWithoutApp['validate']()).rejects.toThrow(
        new TestingBotError('app option is required'),
      );
    });

    it('should throw an error when testApp is missing', async () => {
      fs.promises.access = jest.fn().mockResolvedValueOnce(undefined);

      const optionsWithoutTestApp = new EspressoOptions(
        'path/to/app.apk',
        undefined as unknown as string,
        'Pixel 6',
      );
      const espressoWithoutTestApp = new Espresso(
        mockCredentials,
        optionsWithoutTestApp,
      );

      await expect(espressoWithoutTestApp['validate']()).rejects.toThrow(
        new TestingBotError('testApp option is required'),
      );
    });

    it('should throw error when report is specified without report-output-dir', async () => {
      const optionsWithReport = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        { report: 'junit' },
      );
      const espressoWithReport = new Espresso(
        mockCredentials,
        optionsWithReport,
      );

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(espressoWithReport['validate']()).rejects.toThrow(
        new TestingBotError(
          '--report-output-dir is required when --report is specified',
        ),
      );
    });
  });

  describe('Upload App', () => {
    it('should successfully upload an app and set appId', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = {
        data: {
          id: 1234,
        },
      };

      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(espresso['uploadApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.app);
    });

    it('should throw an error if app upload fails', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = { data: { error: 'Upload failed' } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(espresso['uploadApp']()).rejects.toThrow(
        new TestingBotError('Upload failed: Upload failed'),
      );
    });
  });

  describe('Upload Test App', () => {
    it('should successfully upload the test app', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = {
        data: {
          id: 1234,
        },
      };

      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(espresso['uploadTestApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.testApp);
    });

    it('should throw an error if test app upload fails', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = { data: { error: 'Test app upload failed' } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(espresso['uploadTestApp']()).rejects.toThrow(
        new TestingBotError('Upload failed: Test app upload failed'),
      );
    });
  });

  describe('Run Tests', () => {
    it('should successfully run the tests', async () => {
      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(espresso['runTests']()).resolves.toBe(true);
    });

    it('should send capabilities with device info', async () => {
      espresso['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espresso['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              platformName: 'Android',
              deviceName: 'Pixel 6',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should send all capabilities when provided', async () => {
      const optionsWithCapabilities = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 8',
        {
          version: '14',
          realDevice: true,
          name: 'My Test',
          build: 'build-123',
        },
      );
      const espressoWithCaps = new Espresso(
        mockCredentials,
        optionsWithCapabilities,
      );
      espressoWithCaps['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espressoWithCaps['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              platformName: 'Android',
              deviceName: 'Pixel 8',
              version: '14',
              realDevice: 'true',
              name: 'My Test',
              build: 'build-123',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should send espressoOptions when filtering options provided', async () => {
      const optionsWithFilters = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        {
          class: ['com.example.LoginTest', 'com.example.HomeTest'],
          annotation: ['com.example.SmokeTest'],
          size: ['small', 'medium'],
        },
      );
      const espressoWithFilters = new Espresso(
        mockCredentials,
        optionsWithFilters,
      );
      espressoWithFilters['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espressoWithFilters['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          espressoOptions: {
            class: ['com.example.LoginTest', 'com.example.HomeTest'],
            annotation: ['com.example.SmokeTest'],
            size: ['small', 'medium'],
          },
        }),
        expect.any(Object),
      );
    });

    it('should send localization options when provided', async () => {
      const optionsWithLocalization = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        {
          language: 'fr',
          locale: 'FR',
          timeZone: 'Europe/Paris',
        },
      );
      const espressoWithLocalization = new Espresso(
        mockCredentials,
        optionsWithLocalization,
      );
      espressoWithLocalization['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espressoWithLocalization['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          espressoOptions: {
            language: 'fr',
            locale: 'FR',
            timeZone: 'Europe/Paris',
          },
        }),
        expect.any(Object),
      );
    });

    it('should send geolocation option when provided', async () => {
      const optionsWithGeo = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        {
          geoLocation: 'DE',
        },
      );
      const espressoWithGeo = new Espresso(mockCredentials, optionsWithGeo);
      espressoWithGeo['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espressoWithGeo['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          espressoOptions: {
            geoLocation: 'DE',
          },
        }),
        expect.any(Object),
      );
    });

    it('should send network throttling preset when provided', async () => {
      const optionsWithNetwork = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        {
          throttleNetwork: '3G',
        },
      );
      const espressoWithNetwork = new Espresso(
        mockCredentials,
        optionsWithNetwork,
      );
      espressoWithNetwork['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espressoWithNetwork['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          espressoOptions: {
            throttle_network: '3G',
          },
        }),
        expect.any(Object),
      );
    });

    it('should send custom network profile when provided', async () => {
      const optionsWithCustomNetwork = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        {
          throttleNetwork: {
            uploadSpeed: 500,
            downloadSpeed: 1000,
            latency: 200,
            loss: 5,
          },
        },
      );
      const espressoWithCustomNetwork = new Espresso(
        mockCredentials,
        optionsWithCustomNetwork,
      );
      espressoWithCustomNetwork['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espressoWithCustomNetwork['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          espressoOptions: {
            throttle_network: {
              uploadSpeed: 500,
              downloadSpeed: 1000,
              latency: 200,
              loss: 5,
            },
          },
        }),
        expect.any(Object),
      );
    });

    it('should send testRunner when provided', async () => {
      const optionsWithRunner = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        {
          testRunner: '${packageName}/customTestRunner',
        },
      );
      const espressoWithRunner = new Espresso(
        mockCredentials,
        optionsWithRunner,
      );
      espressoWithRunner['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espressoWithRunner['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          espressoOptions: {
            testRunner: '${packageName}/customTestRunner',
          },
        }),
        expect.any(Object),
      );
    });

    it('should not include espressoOptions when none are set', async () => {
      espresso['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espresso['runTests']();

      const callArgs = (axios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty('espressoOptions');
    });

    it('should throw an error if running tests fails', async () => {
      const mockError = new Error('Test failed');
      axios.post = jest.fn().mockRejectedValueOnce(mockError);

      await expect(espresso['runTests']()).rejects.toThrow(
        new TestingBotError('Running Espresso test failed', {
          cause: mockError,
        }),
      );
    });
  });

  describe('Get Status', () => {
    it('should fetch test status from API', async () => {
      espresso['appId'] = 1234;

      const mockStatusResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: {
                deviceName: 'Pixel 6',
                platformName: 'Android',
              },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValueOnce(mockStatusResponse);

      const result = await espresso['getStatus']();

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/espresso/1234',
        expect.objectContaining({
          auth: {
            username: 'testUser',
            password: 'testKey',
          },
        }),
      );
      expect(result.completed).toBe(true);
      expect(result.success).toBe(true);
      expect(result.runs).toHaveLength(1);
    });
  });

  describe('Wait For Completion', () => {
    beforeEach(() => {
      espresso['appId'] = 1234;
      // Speed up tests by reducing poll interval
      espresso['POLL_INTERVAL_MS'] = 10;
    });

    it('should return success when tests complete successfully', async () => {
      const mockStatusResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: {
                deviceName: 'Pixel 6',
                platformName: 'Android',
              },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(mockStatusResponse);

      const result = await espresso['waitForCompletion']();

      expect(result.success).toBe(true);
      expect(result.runs).toHaveLength(1);
      expect(result.runs[0].success).toBe(1);
    });

    it('should return failure when tests fail', async () => {
      const mockStatusResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: {
                deviceName: 'Pixel 6',
                platformName: 'Android',
              },
              success: 0,
            },
          ],
          success: false,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(mockStatusResponse);

      const result = await espresso['waitForCompletion']();

      expect(result.success).toBe(false);
      expect(result.runs[0].success).toBe(0);
    });

    it('should poll until completion', async () => {
      const waitingResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'WAITING',
              capabilities: {
                deviceName: 'Pixel 6',
                platformName: 'Android',
              },
              success: 0,
            },
          ],
          success: false,
          completed: false,
        },
      };
      const completedResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: {
                deviceName: 'Pixel 6',
                platformName: 'Android',
              },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest
        .fn()
        .mockResolvedValueOnce(waitingResponse)
        .mockResolvedValueOnce(waitingResponse)
        .mockResolvedValueOnce(completedResponse);

      const result = await espresso['waitForCompletion']();

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
    });
  });

  describe('Async Mode', () => {
    it('should return immediately in async mode without polling', async () => {
      const asyncOptions = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        { async: true },
      );
      const asyncEspresso = new Espresso(mockCredentials, asyncOptions);

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      // Mock upload responses
      axios.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadApp
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadTestApp
        .mockResolvedValueOnce({ data: { success: true } }); // runTests

      // getStatus should NOT be called in async mode
      axios.get = jest.fn();

      const result = await asyncEspresso.run();

      expect(result.success).toBe(true);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('Quiet Mode', () => {
    it('should pass showProgress false to upload when quiet mode is enabled', async () => {
      const quietOptions = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        { quiet: true },
      );
      const quietEspresso = new Espresso(mockCredentials, quietOptions);

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      axios.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { id: 1234 } })
        .mockResolvedValueOnce({ data: { id: 1234 } })
        .mockResolvedValueOnce({ data: { success: true } });

      const completedResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: {
                deviceName: 'Pixel 6',
                platformName: 'Android',
              },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(completedResponse);

      await quietEspresso.run();

      expect(quietOptions.quiet).toBe(true);
    });
  });

  describe('Stop Run', () => {
    beforeEach(() => {
      espresso['appId'] = 1234;
    });

    it('should call stop API for a specific run', async () => {
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      await espresso['stopRun'](5678);

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/espresso/1234/5678/stop',
        {},
        expect.objectContaining({
          auth: {
            username: 'testUser',
            password: 'testKey',
          },
        }),
      );
    });

    it('should stop multiple active runs', async () => {
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });
      espresso['activeRunIds'] = [5678, 9012];

      await espresso['stopActiveRuns']();

      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('Real-time Updates', () => {
    const { io } = require('socket.io-client');

    beforeEach(() => {
      jest.clearAllMocks();
      mockSocket.on.mockReset();
      mockSocket.emit.mockReset();
      mockSocket.disconnect.mockReset();
    });

    it('should capture update_server and update_key from runTests response', async () => {
      espresso['appId'] = 1234;

      const mockResponse = {
        data: {
          success: true,
          update_server: 'https://hub.testingbot.com:3031',
          update_key: 'espresso_1234',
        },
      };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await espresso['runTests']();

      expect(espresso['updateServer']).toBe('https://hub.testingbot.com:3031');
      expect(espresso['updateKey']).toBe('espresso_1234');
    });

    it('should connect to update server when update_server and update_key are available', () => {
      espresso['updateServer'] = 'https://hub.testingbot.com:3031';
      espresso['updateKey'] = 'espresso_1234';

      espresso['connectToUpdateServer']();

      expect(io).toHaveBeenCalledWith('https://hub.testingbot.com:3031', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000,
      });
    });

    it('should not connect when quiet mode is enabled', () => {
      const quietOptions = new EspressoOptions(
        'path/to/app.apk',
        'path/to/testApp.apk',
        'Pixel 6',
        { quiet: true },
      );
      const quietEspresso = new Espresso(mockCredentials, quietOptions);
      quietEspresso['updateServer'] = 'https://hub.testingbot.com:3031';
      quietEspresso['updateKey'] = 'espresso_1234';

      quietEspresso['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should not connect when update_server is missing', () => {
      espresso['updateServer'] = null;
      espresso['updateKey'] = 'espresso_1234';

      espresso['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should not connect when update_key is missing', () => {
      espresso['updateServer'] = 'https://hub.testingbot.com:3031';
      espresso['updateKey'] = null;

      espresso['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should join room on connect', () => {
      espresso['updateServer'] = 'https://hub.testingbot.com:3031';
      espresso['updateKey'] = 'espresso_1234';

      // Capture the connect handler
      let connectHandler: () => void = () => {};
      mockSocket.on.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connect') {
          connectHandler = handler;
        }
      });

      espresso['connectToUpdateServer']();

      // Simulate connect event
      connectHandler();

      expect(mockSocket.emit).toHaveBeenCalledWith('join', 'espresso_1234');
    });

    it('should register espresso_data and espresso_error event handlers', () => {
      espresso['updateServer'] = 'https://hub.testingbot.com:3031';
      espresso['updateKey'] = 'espresso_1234';

      espresso['connectToUpdateServer']();

      expect(mockSocket.on).toHaveBeenCalledWith(
        'espresso_data',
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'espresso_error',
        expect.any(Function),
      );
    });

    it('should disconnect from update server', () => {
      espresso['socket'] = mockSocket as never;

      espresso['disconnectFromUpdateServer']();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(espresso['socket']).toBeNull();
    });

    it('should handle espresso_data message and write to stdout', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      const message: EspressoSocketMessage = {
        id: 12345,
        payload: 'Running test: LoginTest\n',
      };

      espresso['handleEspressoData'](JSON.stringify(message));

      expect(stdoutSpy).toHaveBeenCalledWith('Running test: LoginTest\n');

      stdoutSpy.mockRestore();
    });

    it('should handle espresso_error message and write to stderr', () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation();

      const message: EspressoSocketMessage = {
        id: 12345,
        payload: 'Error: Test failed\n',
      };

      espresso['handleEspressoError'](JSON.stringify(message));

      expect(stderrSpy).toHaveBeenCalledWith('Error: Test failed\n');

      stderrSpy.mockRestore();
    });

    it('should ignore invalid JSON in espresso_data', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      // Should not throw
      espresso['handleEspressoData']('invalid json');

      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });

    it('should ignore invalid JSON in espresso_error', () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation();

      // Should not throw
      espresso['handleEspressoError']('invalid json');

      expect(stderrSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('should ignore message with empty payload', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      const message: EspressoSocketMessage = {
        id: 12345,
        payload: '',
      };

      espresso['handleEspressoData'](JSON.stringify(message));

      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });
  });
});
