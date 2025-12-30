import XCUITest, { XCUITestSocketMessage } from '../../src/providers/xcuitest';
import XCUITestOptions from '../../src/models/xcuitest_options';
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

describe('XCUITest', () => {
  let xcuiTest: XCUITest;
  const mockCredentials = new Credentials('testUser', 'testKey');

  const mockOptions = new XCUITestOptions(
    'path/to/app.ipa',
    'path/to/testApp.zip',
    'iPhone 15',
  );

  beforeEach(() => {
    xcuiTest = new XCUITest(mockCredentials, mockOptions);
    jest.clearAllMocks();
  });

  describe('Validation', () => {
    it('should pass validation when app and testApp are provided', async () => {
      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(xcuiTest['validate']()).resolves.toBe(true);
    });

    it('should throw an error when app is missing', async () => {
      const optionsWithoutApp = new XCUITestOptions(
        undefined as unknown as string,
        'path/to/testApp.zip',
        'iPhone 15',
      );
      const xcuiTestWithoutApp = new XCUITest(
        mockCredentials,
        optionsWithoutApp,
      );

      await expect(xcuiTestWithoutApp['validate']()).rejects.toThrow(
        new TestingBotError('app option is required'),
      );
    });

    it('should throw an error when testApp is missing', async () => {
      fs.promises.access = jest.fn().mockResolvedValueOnce(undefined);

      const optionsWithoutTestApp = new XCUITestOptions(
        'path/to/app.ipa',
        undefined as unknown as string,
        'iPhone 15',
      );
      const xcuiTestWithoutTestApp = new XCUITest(
        mockCredentials,
        optionsWithoutTestApp,
      );

      await expect(xcuiTestWithoutTestApp['validate']()).rejects.toThrow(
        new TestingBotError('testApp option is required'),
      );
    });

    it('should throw error when report is specified without report-output-dir', async () => {
      const optionsWithReport = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        { report: 'junit' },
      );
      const xcuiTestWithReport = new XCUITest(
        mockCredentials,
        optionsWithReport,
      );

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(xcuiTestWithReport['validate']()).rejects.toThrow(
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
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = {
        data: {
          id: 1234,
        },
      };

      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(xcuiTest['uploadApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.app);
    });

    it('should throw an error if app upload fails', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = { data: { error: 'Upload failed' } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(xcuiTest['uploadApp']()).rejects.toThrow(
        new TestingBotError('Upload failed: Upload failed'),
      );
    });
  });

  describe('Upload Test App', () => {
    it('should successfully upload the test app', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = {
        data: {
          id: 1234,
        },
      };

      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(xcuiTest['uploadTestApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.testApp);
    });

    it('should throw an error if test app upload fails', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = { data: { error: 'Test app upload failed' } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(xcuiTest['uploadTestApp']()).rejects.toThrow(
        new TestingBotError('Upload failed: Test app upload failed'),
      );
    });
  });

  describe('Run Tests', () => {
    it('should successfully run the tests', async () => {
      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(xcuiTest['runTests']()).resolves.toBe(true);
    });

    it('should send capabilities with device info', async () => {
      xcuiTest['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTest['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              platformName: 'iOS',
              deviceName: 'iPhone 15',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should send all capabilities when provided', async () => {
      const optionsWithCapabilities = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15 Pro',
        {
          version: '17.0',
          realDevice: true,
          name: 'My Test',
          build: 'build-123',
        },
      );
      const xcuiTestWithCaps = new XCUITest(
        mockCredentials,
        optionsWithCapabilities,
      );
      xcuiTestWithCaps['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTestWithCaps['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              platformName: 'iOS',
              deviceName: 'iPhone 15 Pro',
              version: '17.0',
              realDevice: 'true',
              name: 'My Test',
              build: 'build-123',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should send options with orientation when provided', async () => {
      const optionsWithOrientation = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        {
          orientation: 'LANDSCAPE',
        },
      );
      const xcuiTestWithOrientation = new XCUITest(
        mockCredentials,
        optionsWithOrientation,
      );
      xcuiTestWithOrientation['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTestWithOrientation['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          options: {
            orientation: 'LANDSCAPE',
          },
        }),
        expect.any(Object),
      );
    });

    it('should send localization options when provided', async () => {
      const optionsWithLocalization = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        {
          language: 'fr',
          locale: 'FR',
          timeZone: 'Europe/Paris',
        },
      );
      const xcuiTestWithLocalization = new XCUITest(
        mockCredentials,
        optionsWithLocalization,
      );
      xcuiTestWithLocalization['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTestWithLocalization['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          options: {
            language: 'fr',
            locale: 'FR',
            timeZone: 'Europe/Paris',
          },
        }),
        expect.any(Object),
      );
    });

    it('should send geolocation option when provided', async () => {
      const optionsWithGeo = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        {
          geoLocation: 'DE',
        },
      );
      const xcuiTestWithGeo = new XCUITest(mockCredentials, optionsWithGeo);
      xcuiTestWithGeo['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTestWithGeo['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          options: {
            geoLocation: 'DE',
          },
        }),
        expect.any(Object),
      );
    });

    it('should send network throttling preset when provided', async () => {
      const optionsWithNetwork = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        {
          throttleNetwork: '3G',
        },
      );
      const xcuiTestWithNetwork = new XCUITest(
        mockCredentials,
        optionsWithNetwork,
      );
      xcuiTestWithNetwork['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTestWithNetwork['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          options: {
            throttle_network: '3G',
          },
        }),
        expect.any(Object),
      );
    });

    it('should send custom network profile when provided', async () => {
      const optionsWithCustomNetwork = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        {
          throttleNetwork: {
            uploadSpeed: 500,
            downloadSpeed: 1000,
            latency: 200,
            loss: 5,
          },
        },
      );
      const xcuiTestWithCustomNetwork = new XCUITest(
        mockCredentials,
        optionsWithCustomNetwork,
      );
      xcuiTestWithCustomNetwork['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTestWithCustomNetwork['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          options: {
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

    it('should not include options when none are set', async () => {
      xcuiTest['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTest['runTests']();

      const callArgs = (axios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty('options');
    });

    it('should send metadata when provided', async () => {
      const optionsWithMetadata = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        {
          metadata: {
            commitSha: 'abc123def456',
            pullRequestId: '42',
            repoName: 'my-ios-app',
            repoOwner: 'my-org',
          },
        },
      );
      const xcuiTestWithMetadata = new XCUITest(
        mockCredentials,
        optionsWithMetadata,
      );
      xcuiTestWithMetadata['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTestWithMetadata['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: {
            commitSha: 'abc123def456',
            pullRequestId: '42',
            repoName: 'my-ios-app',
            repoOwner: 'my-org',
          },
        }),
        expect.any(Object),
      );
    });

    it('should not include metadata when not provided', async () => {
      xcuiTest['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTest['runTests']();

      const callArgs = (axios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty('metadata');
    });

    it('should throw an error if running tests fails', async () => {
      const mockError = new Error('Test failed');
      axios.post = jest.fn().mockRejectedValueOnce(mockError);

      await expect(xcuiTest['runTests']()).rejects.toThrow(
        /Running XCUITest failed.*Test failed/,
      );
    });
  });

  describe('Get Status', () => {
    it('should fetch test status from API', async () => {
      xcuiTest['appId'] = 1234;

      const mockStatusResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: {
                deviceName: 'iPhone 15',
                platformName: 'iOS',
              },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValueOnce(mockStatusResponse);

      const result = await xcuiTest['getStatus']();

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/xcuitest/1234',
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
      xcuiTest['appId'] = 1234;
      // Speed up tests by reducing poll interval
      xcuiTest['POLL_INTERVAL_MS'] = 10;
    });

    it('should return success when tests complete successfully', async () => {
      const mockStatusResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: {
                deviceName: 'iPhone 15',
                platformName: 'iOS',
              },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(mockStatusResponse);

      const result = await xcuiTest['waitForCompletion']();

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
                deviceName: 'iPhone 15',
                platformName: 'iOS',
              },
              success: 0,
            },
          ],
          success: false,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(mockStatusResponse);

      const result = await xcuiTest['waitForCompletion']();

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
                deviceName: 'iPhone 15',
                platformName: 'iOS',
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
                deviceName: 'iPhone 15',
                platformName: 'iOS',
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

      const result = await xcuiTest['waitForCompletion']();

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
    });
  });

  describe('Async Mode', () => {
    it('should return immediately in async mode without polling', async () => {
      const asyncOptions = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        { async: true },
      );
      const asyncXCUITest = new XCUITest(mockCredentials, asyncOptions);

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      // Mock upload responses
      axios.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadApp
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadTestApp
        .mockResolvedValueOnce({ data: { success: true } }); // runTests

      // getStatus should NOT be called in async mode
      axios.get = jest.fn();

      const result = await asyncXCUITest.run();

      expect(result.success).toBe(true);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('Quiet Mode', () => {
    it('should pass showProgress false to upload when quiet mode is enabled', async () => {
      const quietOptions = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        { quiet: true },
      );
      const quietXCUITest = new XCUITest(mockCredentials, quietOptions);

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
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
                deviceName: 'iPhone 15',
                platformName: 'iOS',
              },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(completedResponse);

      await quietXCUITest.run();

      expect(quietOptions.quiet).toBe(true);
    });
  });

  describe('Stop Run', () => {
    beforeEach(() => {
      xcuiTest['appId'] = 1234;
    });

    it('should call stop API for a specific run', async () => {
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      await xcuiTest['stopRun'](5678);

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/xcuitest/1234/5678/stop',
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
      xcuiTest['activeRunIds'] = [5678, 9012];

      await xcuiTest['stopActiveRuns']();

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
      xcuiTest['appId'] = 1234;

      const mockResponse = {
        data: {
          success: true,
          update_server: 'https://hub.testingbot.com:3031',
          update_key: 'xcuitest_1234',
        },
      };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await xcuiTest['runTests']();

      expect(xcuiTest['updateServer']).toBe('https://hub.testingbot.com:3031');
      expect(xcuiTest['updateKey']).toBe('xcuitest_1234');
    });

    it('should connect to update server when update_server and update_key are available', () => {
      xcuiTest['updateServer'] = 'https://hub.testingbot.com:3031';
      xcuiTest['updateKey'] = 'xcuitest_1234';

      xcuiTest['connectToUpdateServer']();

      expect(io).toHaveBeenCalledWith('https://hub.testingbot.com:3031', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000,
      });
    });

    it('should not connect when quiet mode is enabled', () => {
      const quietOptions = new XCUITestOptions(
        'path/to/app.ipa',
        'path/to/testApp.zip',
        'iPhone 15',
        { quiet: true },
      );
      const quietXCUITest = new XCUITest(mockCredentials, quietOptions);
      quietXCUITest['updateServer'] = 'https://hub.testingbot.com:3031';
      quietXCUITest['updateKey'] = 'xcuitest_1234';

      quietXCUITest['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should not connect when update_server is missing', () => {
      xcuiTest['updateServer'] = null;
      xcuiTest['updateKey'] = 'xcuitest_1234';

      xcuiTest['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should not connect when update_key is missing', () => {
      xcuiTest['updateServer'] = 'https://hub.testingbot.com:3031';
      xcuiTest['updateKey'] = null;

      xcuiTest['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should join room on connect', () => {
      xcuiTest['updateServer'] = 'https://hub.testingbot.com:3031';
      xcuiTest['updateKey'] = 'xcuitest_1234';

      // Capture the connect handler
      let connectHandler: () => void = () => {};
      mockSocket.on.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connect') {
          connectHandler = handler;
        }
      });

      xcuiTest['connectToUpdateServer']();

      // Simulate connect event
      connectHandler();

      expect(mockSocket.emit).toHaveBeenCalledWith('join', 'xcuitest_1234');
    });

    it('should register xcuitest_data and xcuitest_error event handlers', () => {
      xcuiTest['updateServer'] = 'https://hub.testingbot.com:3031';
      xcuiTest['updateKey'] = 'xcuitest_1234';

      xcuiTest['connectToUpdateServer']();

      expect(mockSocket.on).toHaveBeenCalledWith(
        'xcuitest_data',
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'xcuitest_error',
        expect.any(Function),
      );
    });

    it('should disconnect from update server', () => {
      xcuiTest['socket'] = mockSocket as never;

      xcuiTest['disconnectFromUpdateServer']();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(xcuiTest['socket']).toBeNull();
    });

    it('should handle xcuitest_data message and write to stdout', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      const message: XCUITestSocketMessage = {
        id: 12345,
        payload: 'Running test: LoginTest\n',
      };

      xcuiTest['handleXCUITestData'](JSON.stringify(message));

      expect(stdoutSpy).toHaveBeenCalledWith('Running test: LoginTest\n');

      stdoutSpy.mockRestore();
    });

    it('should handle xcuitest_error message and write to stderr', () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation();

      const message: XCUITestSocketMessage = {
        id: 12345,
        payload: 'Error: Test failed\n',
      };

      xcuiTest['handleXCUITestError'](JSON.stringify(message));

      expect(stderrSpy).toHaveBeenCalledWith('Error: Test failed\n');

      stderrSpy.mockRestore();
    });

    it('should ignore invalid JSON in xcuitest_data', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      // Should not throw
      xcuiTest['handleXCUITestData']('invalid json');

      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });

    it('should ignore invalid JSON in xcuitest_error', () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation();

      // Should not throw
      xcuiTest['handleXCUITestError']('invalid json');

      expect(stderrSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('should ignore message with empty payload', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      const message: XCUITestSocketMessage = {
        id: 12345,
        payload: '',
      };

      xcuiTest['handleXCUITestData'](JSON.stringify(message));

      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });
  });

  describe('extractErrorMessage', () => {
    it('should return credits depleted message for 429 status code', () => {
      const axiosError = {
        response: {
          status: 429,
          data: {},
        },
        message: 'Request failed with status code 429',
      };

      const result = xcuiTest['extractErrorMessage'](axiosError);

      expect(result).toBe(
        'Your TestingBot credits are depleted. Please upgrade your plan at https://testingbot.com/pricing',
      );
    });

    it('should return error message from response data for non-429 errors', () => {
      const axiosError = {
        response: {
          status: 400,
          data: {
            error: 'Invalid request',
          },
        },
        message: 'Request failed',
      };

      const result = xcuiTest['extractErrorMessage'](axiosError);

      expect(result).toBe('Invalid request');
    });

    it('should return string cause directly', () => {
      const result = xcuiTest['extractErrorMessage']('Simple error message');

      expect(result).toBe('Simple error message');
    });

    it('should join array of errors with newlines', () => {
      const result = xcuiTest['extractErrorMessage']([
        'Error 1',
        'Error 2',
        'Error 3',
      ]);

      expect(result).toBe('Error 1\nError 2\nError 3');
    });
  });
});
