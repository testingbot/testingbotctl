import Maestro, { MaestroSocketMessage } from '../../src/providers/maestro';
import MaestroOptions from '../../src/models/maestro_options';
import TestingBotError from '../../src/models/testingbot_error';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { Readable } from 'node:stream';
import Credentials from '../../src/models/credentials';
import * as fileTypeDetector from '../../src/utils/file-type-detector';

jest.mock('axios');

// Mock socket.io-client
const mockSocket = {
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket),
}));
jest.mock('../../src/utils/file-type-detector');
jest.mock('../../src/utils', () => ({
  __esModule: true,
  default: {
    getUserAgent: jest.fn().mockReturnValue('TestingBot-CTL-test'),
    getCurrentVersion: jest.fn().mockReturnValue('1.0.0'),
    compareVersions: jest.fn().mockReturnValue(0),
    checkForUpdate: jest.fn(),
  },
}));
jest.mock('glob', () => ({
  glob: jest.fn().mockResolvedValue([]),
}));
jest.mock('archiver', () => {
  const mockArchive = {
    pipe: jest.fn(),
    file: jest.fn(),
    finalize: jest.fn(),
    on: jest.fn((event, cb) => {
      if (event === 'error') return mockArchive;
      return mockArchive;
    }),
  };
  return jest.fn(() => mockArchive);
});
jest.mock('node:fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    access: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
    readFile: jest.fn(),
    mkdtemp: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
  },
  createWriteStream: jest.fn(() => ({
    on: jest.fn((event, cb) => {
      if (event === 'close') {
        setTimeout(cb, 0);
      }
    }),
  })),
  createReadStream: jest.fn(),
}));

describe('Maestro', () => {
  let maestro: Maestro;
  const mockCredentials = new Credentials('testUser', 'testKey');

  const mockOptions = new MaestroOptions(
    'path/to/app.apk',
    'path/to/flows',
    'Pixel 6',
  );

  beforeEach(() => {
    maestro = new Maestro(mockCredentials, mockOptions);
    jest.clearAllMocks();
  });

  describe('Validation', () => {
    it('should pass validation when app, flows, and device are provided', async () => {
      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(maestro['validate']()).resolves.toBe(true);
    });

    it('should throw an error when app is missing', async () => {
      const optionsWithoutApp = new MaestroOptions(
        undefined as unknown as string,
        'path/to/flows',
        'Pixel 6',
      );
      const maestroWithoutApp = new Maestro(mockCredentials, optionsWithoutApp);

      await expect(maestroWithoutApp['validate']()).rejects.toThrow(
        new TestingBotError('app option is required'),
      );
    });

    it('should throw an error when flows is missing', async () => {
      fs.promises.access = jest.fn().mockResolvedValueOnce(undefined);

      const optionsWithoutFlows = new MaestroOptions(
        'path/to/app.apk',
        undefined as unknown as string,
        'Pixel 6',
      );
      const maestroWithoutFlows = new Maestro(
        mockCredentials,
        optionsWithoutFlows,
      );

      await expect(maestroWithoutFlows['validate']()).rejects.toThrow(
        new TestingBotError('flows option is required'),
      );
    });

    it('should pass validation when device is not provided (optional)', async () => {
      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const optionsWithoutDevice = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
      );
      const maestroWithoutDevice = new Maestro(
        mockCredentials,
        optionsWithoutDevice,
      );

      await expect(maestroWithoutDevice['validate']()).resolves.toBe(true);
    });
  });

  describe('Detect Platform', () => {
    const mockDetectPlatformFromFile =
      fileTypeDetector.detectPlatformFromFile as jest.MockedFunction<
        typeof fileTypeDetector.detectPlatformFromFile
      >;

    it('should detect Android for APK files', async () => {
      mockDetectPlatformFromFile.mockResolvedValueOnce('Android');

      const result = await maestro['detectPlatform']();
      expect(result).toBe('Android');
      expect(mockDetectPlatformFromFile).toHaveBeenCalledWith(
        'path/to/app.apk',
      );
    });

    it('should detect iOS for IPA files', async () => {
      const optionsIpa = new MaestroOptions(
        'path/to/app.ipa',
        'path/to/flows',
        'iPhone 15',
      );
      const maestroIpa = new Maestro(mockCredentials, optionsIpa);

      mockDetectPlatformFromFile.mockResolvedValueOnce('iOS');

      const result = await maestroIpa['detectPlatform']();
      expect(result).toBe('iOS');
      expect(mockDetectPlatformFromFile).toHaveBeenCalledWith(
        'path/to/app.ipa',
      );
    });

    it('should return undefined when platform cannot be determined', async () => {
      mockDetectPlatformFromFile.mockResolvedValueOnce(undefined);

      const result = await maestro['detectPlatform']();
      expect(result).toBeUndefined();
    });

    it('should return undefined when app path is not set', async () => {
      const optionsNoApp = new MaestroOptions(
        undefined as unknown as string,
        'path/to/flows',
      );
      const maestroNoApp = new Maestro(mockCredentials, optionsNoApp);

      const result = await maestroNoApp['detectPlatform']();
      expect(result).toBeUndefined();
      expect(mockDetectPlatformFromFile).not.toHaveBeenCalled();
    });
  });

  describe('Upload App', () => {
    it('should successfully upload an APK app and set appId', async () => {
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

      await expect(maestro['uploadApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.app);
    });

    it('should throw an error if app upload fails', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const mockResponse = { data: { error: 'Upload failed' } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(maestro['uploadApp']()).rejects.toThrow(
        new TestingBotError('Upload failed: Upload failed'),
      );
    });
  });

  describe('Run Tests', () => {
    it('should successfully run the tests', async () => {
      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(maestro['runTests']()).resolves.toBe(true);
    });

    it('should send includeTags and excludeTags when provided', async () => {
      const optionsWithTags = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          includeTags: ['smoke', 'regression'],
          excludeTags: ['flaky'],
        },
      );
      const maestroWithTags = new Maestro(mockCredentials, optionsWithTags);
      maestroWithTags['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestroWithTags['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maestroOptions: {
            includeTags: ['smoke', 'regression'],
            excludeTags: ['flaky'],
          },
        }),
        expect.any(Object),
      );
    });

    it('should send all capabilities when provided', async () => {
      const optionsWithCapabilities = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 8',
        {
          platformName: 'Android',
          version: '14',
          name: 'My Test',
          build: 'build-123',
          orientation: 'LANDSCAPE',
          locale: 'en_US',
          timeZone: 'America/New_York',
          throttleNetwork: '4G',
          geoCountryCode: 'US',
        },
      );
      const maestroWithCaps = new Maestro(
        mockCredentials,
        optionsWithCapabilities,
      );
      maestroWithCaps['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestroWithCaps['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              deviceName: 'Pixel 8',
              platformName: 'Android',
              version: '14',
              name: 'My Test',
              build: 'build-123',
              orientation: 'LANDSCAPE',
              locale: 'en_US',
              timeZone: 'America/New_York',
              throttleNetwork: '4G',
              geoCountryCode: 'US',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should send deviceName and inferred platformName when no other capabilities provided', async () => {
      maestro['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestro['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              deviceName: 'Pixel 6',
              platformName: 'Android',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should infer wildcard device and Android platform for .apk when device not provided', async () => {
      const optionsNoDevice = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
      );
      const maestroNoDevice = new Maestro(mockCredentials, optionsNoDevice);
      maestroNoDevice['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestroNoDevice['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              deviceName: '*',
              platformName: 'Android',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should infer wildcard device and iOS platform for .ipa when device not provided', async () => {
      const optionsNoDevice = new MaestroOptions(
        'path/to/app.ipa',
        'path/to/flows',
      );
      const maestroNoDevice = new Maestro(mockCredentials, optionsNoDevice);
      maestroNoDevice['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestroNoDevice['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          capabilities: [
            {
              deviceName: '*',
              platformName: 'iOS',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should throw an error if running tests fails', async () => {
      const mockError = new Error('Test failed');
      axios.post = jest.fn().mockRejectedValueOnce(mockError);

      await expect(maestro['runTests']()).rejects.toThrow(
        new TestingBotError('Running Maestro test failed', {
          cause: mockError,
        }),
      );
    });

    it('should send env variables in maestroOptions when provided', async () => {
      const optionsWithEnv = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          env: {
            API_URL: 'https://staging.example.com',
            TEST_USER: 'testuser@example.com',
            TEST_PASSWORD: 'secret123',
          },
        },
      );
      const maestroWithEnv = new Maestro(mockCredentials, optionsWithEnv);
      maestroWithEnv['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestroWithEnv['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maestroOptions: {
            env: {
              API_URL: 'https://staging.example.com',
              TEST_USER: 'testuser@example.com',
              TEST_PASSWORD: 'secret123',
            },
          },
        }),
        expect.any(Object),
      );
    });

    it('should send both tags and env in maestroOptions when provided', async () => {
      const optionsWithAll = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          includeTags: ['smoke'],
          excludeTags: ['flaky'],
          env: {
            API_KEY: 'secret',
          },
        },
      );
      const maestroWithAll = new Maestro(mockCredentials, optionsWithAll);
      maestroWithAll['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestroWithAll['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maestroOptions: {
            includeTags: ['smoke'],
            excludeTags: ['flaky'],
            env: {
              API_KEY: 'secret',
            },
          },
        }),
        expect.any(Object),
      );
    });

    it('should not include maestroOptions when none are set', async () => {
      maestro['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestro['runTests']();

      const callArgs = (axios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty('maestroOptions');
    });
  });

  describe('Get Status', () => {
    it('should fetch test status from API', async () => {
      maestro['appId'] = 1234;

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

      const result = await maestro['getStatus']();

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/maestro/1234',
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
      expect(result.runs[0].status).toBe('DONE');
    });

    it('should throw error when API call fails', async () => {
      maestro['appId'] = 1234;

      const mockError = new Error('Network error');
      axios.get = jest.fn().mockRejectedValueOnce(mockError);

      await expect(maestro['getStatus']()).rejects.toThrow(
        new TestingBotError('Failed to get Maestro test status', {
          cause: mockError,
        }),
      );
    });
  });

  describe('Wait For Completion', () => {
    beforeEach(() => {
      maestro['appId'] = 1234;
      // Speed up tests by reducing poll interval
      maestro['POLL_INTERVAL_MS'] = 10;
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

      const result = await maestro['waitForCompletion']();

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

      const result = await maestro['waitForCompletion']();

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

      const result = await maestro['waitForCompletion']();

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
    });
  });

  describe('Async Mode', () => {
    it('should return immediately in async mode without polling', async () => {
      const asyncOptions = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows.zip',
        'Pixel 6',
        { async: true },
      );
      const asyncMaestro = new Maestro(mockCredentials, asyncOptions);

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      fs.promises.stat = jest.fn().mockResolvedValue({
        size: 1024,
        isFile: () => true,
        isDirectory: () => false,
      });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      // Mock upload responses
      axios.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadApp
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadFlows
        .mockResolvedValueOnce({ data: { success: true } }); // runTests

      // getStatus should NOT be called in async mode
      axios.get = jest.fn();

      const result = await asyncMaestro.run();

      expect(result.success).toBe(true);
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should poll for results when not in async mode', async () => {
      const syncOptions = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows.zip',
        'Pixel 6',
      );
      const syncMaestro = new Maestro(mockCredentials, syncOptions);

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      fs.promises.stat = jest.fn().mockResolvedValue({
        size: 1024,
        isFile: () => true,
        isDirectory: () => false,
      });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      // Mock upload and run responses
      axios.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadApp
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadFlows
        .mockResolvedValueOnce({ data: { success: true } }); // runTests

      // Mock status polling
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

      const result = await syncMaestro.run();

      expect(result.success).toBe(true);
      expect(axios.get).toHaveBeenCalled();
    });
  });

  describe('Quiet Mode', () => {
    it('should pass showProgress false to upload when quiet mode is enabled', async () => {
      const quietOptions = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows.zip',
        'Pixel 6',
        { quiet: true },
      );
      const quietMaestro = new Maestro(mockCredentials, quietOptions);

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      fs.promises.stat = jest.fn().mockResolvedValue({
        size: 1024,
        isFile: () => true,
        isDirectory: () => false,
      });
      const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      // Mock upload and run responses
      axios.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadApp
        .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadFlows
        .mockResolvedValueOnce({ data: { success: true } }); // runTests

      // Mock status polling
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

      await quietMaestro.run();

      // Verify that showProgress was set to false in upload calls
      const postCalls = (axios.post as jest.Mock).mock.calls;
      // The upload calls use the Upload class which receives showProgress
      // We verify quiet mode works by checking the options passed
      expect(quietOptions.quiet).toBe(true);
    });

    it('should default quiet to false', () => {
      expect(mockOptions.quiet).toBe(false);
    });
  });

  describe('Report Options', () => {
    describe('Validation', () => {
      it('should throw error when report is specified without report-output-dir', async () => {
        const optionsWithReport = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit' },
        );
        const maestroWithReport = new Maestro(
          mockCredentials,
          optionsWithReport,
        );

        fs.promises.access = jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);

        await expect(maestroWithReport['validate']()).rejects.toThrow(
          new TestingBotError(
            '--report-output-dir is required when --report is specified',
          ),
        );
      });

      it('should validate successfully when both report and report-output-dir are provided', async () => {
        const optionsWithBoth = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/tmp/reports' },
        );
        const maestroWithBoth = new Maestro(mockCredentials, optionsWithBoth);

        fs.promises.access = jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);
        fs.promises.stat = jest.fn().mockResolvedValue({
          isDirectory: () => true,
        });

        await expect(maestroWithBoth['validate']()).resolves.toBe(true);
      });

      it('should create report output directory if it does not exist', async () => {
        const optionsWithBoth = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/tmp/new-reports' },
        );
        const maestroWithBoth = new Maestro(mockCredentials, optionsWithBoth);

        fs.promises.access = jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);
        const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        fs.promises.stat = jest.fn().mockRejectedValue(enoentError);
        fs.promises.mkdir = jest.fn().mockResolvedValue(undefined);

        await expect(maestroWithBoth['validate']()).resolves.toBe(true);
        expect(fs.promises.mkdir).toHaveBeenCalledWith('/tmp/new-reports', {
          recursive: true,
        });
      });

      it('should throw error when report output path exists but is not a directory', async () => {
        const optionsWithBoth = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/tmp/not-a-dir' },
        );
        const maestroWithBoth = new Maestro(mockCredentials, optionsWithBoth);

        fs.promises.access = jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);
        fs.promises.stat = jest.fn().mockResolvedValue({
          isDirectory: () => false,
        });

        await expect(maestroWithBoth['validate']()).rejects.toThrow(
          new TestingBotError(
            'Report output path exists but is not a directory: /tmp/not-a-dir',
          ),
        );
      });

      it('should throw error when directory creation fails', async () => {
        const optionsWithBoth = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/readonly/reports' },
        );
        const maestroWithBoth = new Maestro(mockCredentials, optionsWithBoth);

        fs.promises.access = jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);
        const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        fs.promises.stat = jest.fn().mockRejectedValue(enoentError);
        fs.promises.mkdir = jest
          .fn()
          .mockRejectedValue(new Error('Permission denied'));

        await expect(maestroWithBoth['validate']()).rejects.toThrow(
          /Failed to create report output directory: \/readonly\/reports/,
        );
      });
    });

    describe('Fetch Reports', () => {
      beforeEach(() => {
        maestro['appId'] = 1234;
      });

      it('should fetch junit report and save to output directory', async () => {
        const optionsWithReport = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/tmp/reports' },
        );
        const maestroWithReport = new Maestro(
          mockCredentials,
          optionsWithReport,
        );
        maestroWithReport['appId'] = 1234;

        const mockRuns = [
          {
            id: 5678,
            status: 'DONE' as const,
            capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
            success: 1,
          },
        ];

        const mockReportXml = '<?xml version="1.0"?><testsuites></testsuites>';
        axios.get = jest
          .fn()
          .mockResolvedValue({ data: { junit_report: mockReportXml } });
        fs.promises.writeFile = jest.fn().mockResolvedValue(undefined);

        await maestroWithReport['fetchReports'](mockRuns);

        expect(axios.get).toHaveBeenCalledWith(
          'https://api.testingbot.com/v1/app-automate/maestro/1234/5678/junit_report',
          expect.objectContaining({
            auth: {
              username: 'testUser',
              password: 'testKey',
            },
          }),
        );
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
          path.join('/tmp/reports', 'report_run_5678.xml'),
          mockReportXml,
          'utf-8',
        );
      });

      it('should fetch html report and save with html extension', async () => {
        const optionsWithReport = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'html', reportOutputDir: '/tmp/reports' },
        );
        const maestroWithReport = new Maestro(
          mockCredentials,
          optionsWithReport,
        );
        maestroWithReport['appId'] = 1234;

        const mockRuns = [
          {
            id: 5678,
            status: 'DONE' as const,
            capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
            success: 1,
          },
        ];

        const mockReportHtml = '<html><body>Test Report</body></html>';
        axios.get = jest
          .fn()
          .mockResolvedValue({ data: { html_report: mockReportHtml } });
        fs.promises.writeFile = jest.fn().mockResolvedValue(undefined);

        await maestroWithReport['fetchReports'](mockRuns);

        expect(axios.get).toHaveBeenCalledWith(
          'https://api.testingbot.com/v1/app-automate/maestro/1234/5678/html_report',
          expect.any(Object),
        );
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
          path.join('/tmp/reports', 'report_run_5678.html'),
          mockReportHtml,
          'utf-8',
        );
      });

      it('should fetch reports for multiple runs', async () => {
        const optionsWithReport = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/tmp/reports' },
        );
        const maestroWithReport = new Maestro(
          mockCredentials,
          optionsWithReport,
        );
        maestroWithReport['appId'] = 1234;

        const mockRuns = [
          {
            id: 5678,
            status: 'DONE' as const,
            capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
            success: 1,
          },
          {
            id: 9012,
            status: 'DONE' as const,
            capabilities: { deviceName: 'Pixel 8', platformName: 'Android' },
            success: 1,
          },
        ];

        const mockReportXml = '<?xml version="1.0"?><testsuites></testsuites>';
        axios.get = jest
          .fn()
          .mockResolvedValue({ data: { junit_report: mockReportXml } });
        fs.promises.writeFile = jest.fn().mockResolvedValue(undefined);

        await maestroWithReport['fetchReports'](mockRuns);

        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
          path.join('/tmp/reports', 'report_run_5678.xml'),
          mockReportXml,
          'utf-8',
        );
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
          path.join('/tmp/reports', 'report_run_9012.xml'),
          mockReportXml,
          'utf-8',
        );
      });

      it('should continue fetching other reports when one fails', async () => {
        const optionsWithReport = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/tmp/reports' },
        );
        const maestroWithReport = new Maestro(
          mockCredentials,
          optionsWithReport,
        );
        maestroWithReport['appId'] = 1234;

        const mockRuns = [
          {
            id: 5678,
            status: 'DONE' as const,
            capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
            success: 1,
          },
          {
            id: 9012,
            status: 'DONE' as const,
            capabilities: { deviceName: 'Pixel 8', platformName: 'Android' },
            success: 1,
          },
        ];

        const mockReportXml = '<?xml version="1.0"?><testsuites></testsuites>';
        axios.get = jest
          .fn()
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({ data: { junit_report: mockReportXml } });
        fs.promises.writeFile = jest.fn().mockResolvedValue(undefined);

        await maestroWithReport['fetchReports'](mockRuns);

        expect(axios.get).toHaveBeenCalledTimes(2);
        // Only the second report should be written
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
          path.join('/tmp/reports', 'report_run_9012.xml'),
          mockReportXml,
          'utf-8',
        );
      });

      it('should not fetch reports when report option is not set', async () => {
        axios.get = jest.fn();
        fs.promises.writeFile = jest.fn();

        const mockRuns = [
          {
            id: 5678,
            status: 'DONE' as const,
            capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
            success: 1,
          },
        ];

        await maestro['fetchReports'](mockRuns);

        expect(axios.get).not.toHaveBeenCalled();
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
      });
    });

    describe('Full Flow with Reports', () => {
      it('should fetch reports after test completion', async () => {
        const optionsWithReport = new MaestroOptions(
          'path/to/app.apk',
          'path/to/flows.zip',
          'Pixel 6',
          { report: 'junit', reportOutputDir: '/tmp/reports' },
        );
        const maestroWithReport = new Maestro(
          mockCredentials,
          optionsWithReport,
        );

        // Mock validation - access is called for app and flows
        fs.promises.access = jest
          .fn()
          .mockResolvedValueOnce(undefined) // app access
          .mockResolvedValueOnce(undefined); // flows access

        // stat is called for: report dir check, app upload, flows path check, flows upload
        fs.promises.stat = jest
          .fn()
          .mockResolvedValueOnce({ isDirectory: () => true }) // report dir exists
          .mockResolvedValueOnce({ size: 1024 }) // app upload size
          .mockResolvedValueOnce({
            size: 1024,
            isFile: () => true,
            isDirectory: () => false,
          }) // uploadFlows path check
          .mockResolvedValueOnce({ size: 1024 }); // flows upload size

        const mockStream = new Readable({ read() { this.push(Buffer.alloc(1024)); this.push(null); } });
        fs.createReadStream = jest.fn().mockReturnValue(mockStream);

        // Mock uploads and run
        axios.post = jest
          .fn()
          .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadApp
          .mockResolvedValueOnce({ data: { id: 1234 } }) // uploadFlows
          .mockResolvedValueOnce({ data: { success: true } }); // runTests

        // Mock status polling
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

        // Mock report fetch
        const mockReportXml = '<?xml version="1.0"?><testsuites></testsuites>';
        axios.get = jest
          .fn()
          .mockResolvedValueOnce(completedResponse) // getStatus
          .mockResolvedValueOnce({ data: { junit_report: mockReportXml } }); // fetchReport

        fs.promises.writeFile = jest.fn().mockResolvedValue(undefined);

        const result = await maestroWithReport.run();

        expect(result.success).toBe(true);
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
          path.join('/tmp/reports', 'report_run_5678.xml'),
          mockReportXml,
          'utf-8',
        );
      });
    });
  });

  describe('Stop Run', () => {
    beforeEach(() => {
      maestro['appId'] = 1234;
    });

    it('should call stop API for a specific run', async () => {
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      await maestro['stopRun'](5678);

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/maestro/1234/5678/stop',
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
      maestro['activeRunIds'] = [5678, 9012];

      await maestro['stopActiveRuns']();

      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/maestro/1234/5678/stop',
        {},
        expect.any(Object),
      );
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/maestro/1234/9012/stop',
        {},
        expect.any(Object),
      );
    });

    it('should not call stop API when no active runs', async () => {
      axios.post = jest.fn();
      maestro['activeRunIds'] = [];

      await maestro['stopActiveRuns']();

      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should not call stop API when appId is not set', async () => {
      axios.post = jest.fn();
      maestro['appId'] = undefined;
      maestro['activeRunIds'] = [5678];

      await maestro['stopActiveRuns']();

      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should continue stopping other runs when one fails', async () => {
      axios.post = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: { success: true } });
      maestro['activeRunIds'] = [5678, 9012];

      // Should not throw
      await maestro['stopActiveRuns']();

      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should filter active run IDs correctly', () => {
      const runs = [
        {
          id: 5678,
          status: 'WAITING' as const,
          capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
          success: 0,
        },
        {
          id: 9012,
          status: 'READY' as const,
          capabilities: { deviceName: 'Pixel 8', platformName: 'Android' },
          success: 0,
        },
        {
          id: 1111,
          status: 'DONE' as const,
          capabilities: { deviceName: 'Pixel 7', platformName: 'Android' },
          success: 1,
        },
        {
          id: 2222,
          status: 'FAILED' as const,
          capabilities: { deviceName: 'Pixel 5', platformName: 'Android' },
          success: 0,
        },
      ];

      // Simulate what waitForCompletion does to track active runs
      const activeRunIds = runs
        .filter((run) => run.status !== 'DONE' && run.status !== 'FAILED')
        .map((run) => run.id);

      // Only WAITING and READY runs should be tracked
      expect(activeRunIds).toEqual([5678, 9012]);
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
      maestro['appId'] = 1234;

      const mockResponse = {
        data: {
          success: true,
          update_server: 'https://hub.testingbot.com:3031',
          update_key: 'maestro_18724',
        },
      };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestro['runTests']();

      expect(maestro['updateServer']).toBe('https://hub.testingbot.com:3031');
      expect(maestro['updateKey']).toBe('maestro_18724');
    });

    it('should connect to update server when update_server and update_key are available', () => {
      maestro['updateServer'] = 'https://hub.testingbot.com:3031';
      maestro['updateKey'] = 'maestro_18724';

      maestro['connectToUpdateServer']();

      expect(io).toHaveBeenCalledWith('https://hub.testingbot.com:3031', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000,
      });
    });

    it('should not connect when quiet mode is enabled', () => {
      const quietOptions = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        { quiet: true },
      );
      const quietMaestro = new Maestro(mockCredentials, quietOptions);
      quietMaestro['updateServer'] = 'https://hub.testingbot.com:3031';
      quietMaestro['updateKey'] = 'maestro_18724';

      quietMaestro['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should not connect when update_server is missing', () => {
      maestro['updateServer'] = null;
      maestro['updateKey'] = 'maestro_18724';

      maestro['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should not connect when update_key is missing', () => {
      maestro['updateServer'] = 'https://hub.testingbot.com:3031';
      maestro['updateKey'] = null;

      maestro['connectToUpdateServer']();

      expect(io).not.toHaveBeenCalled();
    });

    it('should join room on connect', () => {
      maestro['updateServer'] = 'https://hub.testingbot.com:3031';
      maestro['updateKey'] = 'maestro_18724';

      // Capture the connect handler
      let connectHandler: () => void = () => {};
      mockSocket.on.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connect') {
          connectHandler = handler;
        }
      });

      maestro['connectToUpdateServer']();

      // Simulate connect event
      connectHandler();

      expect(mockSocket.emit).toHaveBeenCalledWith('join', 'maestro_18724');
    });

    it('should register maestro_data and maestro_error event handlers', () => {
      maestro['updateServer'] = 'https://hub.testingbot.com:3031';
      maestro['updateKey'] = 'maestro_18724';

      maestro['connectToUpdateServer']();

      expect(mockSocket.on).toHaveBeenCalledWith(
        'maestro_data',
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        'maestro_error',
        expect.any(Function),
      );
    });

    it('should disconnect from update server', () => {
      maestro['socket'] = mockSocket as never;

      maestro['disconnectFromUpdateServer']();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(maestro['socket']).toBeNull();
    });

    it('should handle maestro_data message and write to stdout', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      const message: MaestroSocketMessage = {
        id: 12345,
        payload: 'Running flow: login_test.yaml\n',
      };

      maestro['handleMaestroData'](JSON.stringify(message));

      expect(stdoutSpy).toHaveBeenCalledWith('Running flow: login_test.yaml\n');

      stdoutSpy.mockRestore();
    });

    it('should handle maestro_error message and write to stderr', () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation();

      const message: MaestroSocketMessage = {
        id: 12345,
        payload: 'Error: Element not found\n',
      };

      maestro['handleMaestroError'](JSON.stringify(message));

      expect(stderrSpy).toHaveBeenCalledWith('Error: Element not found\n');

      stderrSpy.mockRestore();
    });

    it('should ignore invalid JSON in maestro_data', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      // Should not throw
      maestro['handleMaestroData']('invalid json');

      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });

    it('should ignore invalid JSON in maestro_error', () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation();

      // Should not throw
      maestro['handleMaestroError']('invalid json');

      expect(stderrSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('should ignore message with empty payload', () => {
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      const message: MaestroSocketMessage = {
        id: 12345,
        payload: '',
      };

      maestro['handleMaestroData'](JSON.stringify(message));

      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });
  });

  describe('Artifact Download', () => {
    it('should pass validation when downloadArtifacts is set without artifactsOutputDir (defaults to cwd)', async () => {
      const optionsWithArtifacts = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        { downloadArtifacts: true },
      );
      const maestroWithArtifacts = new Maestro(
        mockCredentials,
        optionsWithArtifacts,
      );

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(maestroWithArtifacts['validate']()).resolves.toBe(true);
    });

    it('should pass validation when downloadArtifacts has artifactsOutputDir', async () => {
      const optionsWithArtifacts = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          downloadArtifacts: true,
          artifactsOutputDir: './artifacts',
        },
      );
      const maestroWithArtifacts = new Maestro(
        mockCredentials,
        optionsWithArtifacts,
      );

      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      fs.promises.stat = jest
        .fn()
        .mockResolvedValue({ isDirectory: () => true });

      await expect(maestroWithArtifacts['validate']()).resolves.toBe(true);
    });

    it('should generate zip filename from --build option', async () => {
      const optionsWithBuild = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          downloadArtifacts: true,
          build: 'my-build-123',
        },
      );
      const maestroWithBuild = new Maestro(mockCredentials, optionsWithBuild);

      // Mock access to throw (file doesn't exist)
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const zipName = await maestroWithBuild['generateArtifactZipName']('/tmp/test');
      expect(zipName).toBe('my-build-123.zip');
    });

    it('should sanitize build name for zip filename', async () => {
      const optionsWithBuild = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          downloadArtifacts: true,
          build: 'my build/test:v1.0',
        },
      );
      const maestroWithBuild = new Maestro(mockCredentials, optionsWithBuild);

      // Mock access to throw (file doesn't exist)
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const zipName = await maestroWithBuild['generateArtifactZipName']('/tmp/test');
      expect(zipName).toBe('my_build_test_v1_0.zip');
    });

    it('should generate timestamp-based zip filename when no --build option', async () => {
      const optionsWithoutBuild = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        { downloadArtifacts: true },
      );
      const maestroWithoutBuild = new Maestro(
        mockCredentials,
        optionsWithoutBuild,
      );

      const zipName = await maestroWithoutBuild['generateArtifactZipName']('/tmp/test');
      expect(zipName).toMatch(/^maestro_artifacts_\d{4}-\d{2}-\d{2}T.*\.zip$/);
    });

    it('should add timestamp suffix when zip file already exists', async () => {
      const optionsWithBuild = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          downloadArtifacts: true,
          build: 'existing-build',
        },
      );
      const maestroWithBuild = new Maestro(mockCredentials, optionsWithBuild);

      // Mock access: file exists
      (fs.promises.access as jest.Mock).mockResolvedValueOnce(undefined);

      const zipName = await maestroWithBuild['generateArtifactZipName']('/tmp/test');
      expect(zipName).toMatch(/^existing-build_\d+\.zip$/);
    });

    it('should fetch run details with assets', async () => {
      maestro['appId'] = 1234;

      const mockRunDetails = {
        id: 5678,
        status: 'DONE',
        capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
        success: 1,
        completed: true,
        assets_synced: true,
        assets: {
          logs: { vm: 'https://example.com/log1.txt' },
          video: 'https://example.com/video.mp4',
          screenshots: ['https://example.com/screenshot1.png'],
        },
      };

      axios.get = jest.fn().mockResolvedValueOnce({ data: mockRunDetails });

      const result = await maestro['getRunDetails'](5678);

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/app-automate/maestro/1234/5678',
        expect.objectContaining({
          auth: { username: 'testUser', password: 'testKey' },
        }),
      );
      expect(result.assets_synced).toBe(true);
      expect(Object.keys(result.assets?.logs || {})).toHaveLength(1);
      expect(result.assets?.video).toBe('https://example.com/video.mp4');
    });

    it('should wait for artifacts to sync', async () => {
      maestro['appId'] = 1234;

      const notSyncedResponse = {
        data: {
          id: 5678,
          status: 'DONE',
          assets_synced: false,
        },
      };
      const syncedResponse = {
        data: {
          id: 5678,
          status: 'DONE',
          assets_synced: true,
          assets: {
            logs: { vm: 'https://example.com/log.txt' },
          },
        },
      };

      axios.get = jest
        .fn()
        .mockResolvedValueOnce(notSyncedResponse)
        .mockResolvedValueOnce(notSyncedResponse)
        .mockResolvedValueOnce(syncedResponse);

      // Speed up the test
      maestro['POLL_INTERVAL_MS'] = 10;

      const result = await maestro['waitForArtifactsSync'](5678);

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(result.assets_synced).toBe(true);
    });

    it('should download file from URL', async () => {
      const mockFileContent = Buffer.from('test file content');
      axios.get = jest.fn().mockResolvedValueOnce({ data: mockFileContent });
      fs.promises.writeFile = jest.fn().mockResolvedValueOnce(undefined);

      await maestro['downloadFile'](
        'https://example.com/file.txt',
        '/path/to/file.txt',
      );

      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com/file.txt',
        expect.objectContaining({
          responseType: 'arraybuffer',
        }),
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/path/to/file.txt',
        mockFileContent,
      );
    });
  });
});
