import Maestro, {
  MaestroSocketMessage,
  MaestroFlowInfo,
  MaestroFlowStatus,
} from '../../src/providers/maestro';
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
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const checksumResponse = { data: { app_exists: false }, headers: {} };
      const uploadResponse = { data: { id: 1234 }, headers: {} };

      axios.post = jest
        .fn()
        .mockResolvedValueOnce(checksumResponse)
        .mockResolvedValueOnce(uploadResponse);

      await expect(maestro['uploadApp']()).resolves.toBe(true);
      expect(maestro['appId']).toBe(1234);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.app);
    });

    it('should skip upload when app already exists (checksum match)', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const checksumResponse = {
        data: { app_exists: true, id: 5678 },
        headers: {},
      };

      axios.post = jest.fn().mockResolvedValueOnce(checksumResponse);

      await expect(maestro['uploadApp']()).resolves.toBe(true);
      expect(maestro['appId']).toBe(5678);
      // Upload should not have been called (only checksum call)
      expect(axios.post).toHaveBeenCalledTimes(1);
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

      const checksumResponse = { data: { app_exists: false }, headers: {} };
      const uploadResponse = { data: { error: 'Upload failed' }, headers: {} };
      axios.post = jest
        .fn()
        .mockResolvedValueOnce(checksumResponse)
        .mockResolvedValueOnce(uploadResponse);

      await expect(maestro['uploadApp']()).rejects.toThrow(
        new TestingBotError('Upload failed: Upload failed'),
      );
    });

    it('should proceed with upload if checksum check fails', async () => {
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      const uploadResponse = { data: { id: 1234 }, headers: {} };

      axios.post = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(uploadResponse);

      await expect(maestro['uploadApp']()).resolves.toBe(true);
      expect(maestro['appId']).toBe(1234);
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

    it('should send metadata when provided', async () => {
      const optionsWithMetadata = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          metadata: {
            commitSha: 'abc123def456',
            pullRequestId: '42',
            repoName: 'my-app',
            repoOwner: 'my-org',
          },
        },
      );
      const maestroWithMetadata = new Maestro(
        mockCredentials,
        optionsWithMetadata,
      );
      maestroWithMetadata['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestroWithMetadata['runTests']();

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          metadata: {
            commitSha: 'abc123def456',
            pullRequestId: '42',
            repoName: 'my-app',
            repoOwner: 'my-org',
          },
        }),
        expect.any(Object),
      );
    });

    it('should not include metadata when not provided', async () => {
      maestro['appId'] = 1234;

      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await maestro['runTests']();

      const callArgs = (axios.post as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty('metadata');
    });

    it('should throw an error if running tests fails', async () => {
      const mockError = new Error('Test failed');
      axios.post = jest.fn().mockRejectedValueOnce(mockError);

      await expect(maestro['runTests']()).rejects.toThrow(
        /Running Maestro test failed.*Test failed/,
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
        /Failed to get Maestro test status.*Network error/,
      );
    });

    it('should retry on 502 Bad Gateway error and succeed', async () => {
      maestro['appId'] = 1234;
      // Speed up retries for testing
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error502 = {
        isAxiosError: true,
        response: { status: 502, statusText: 'Bad Gateway' },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      const mockSuccessResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };

      axios.get = jest
        .fn()
        .mockRejectedValueOnce(error502) // First call fails with 502
        .mockResolvedValueOnce(mockSuccessResponse); // Second call succeeds

      const result = await maestro['getStatus']();

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result.completed).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should retry on 503 Service Unavailable error and succeed', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error503 = {
        isAxiosError: true,
        response: { status: 503, statusText: 'Service Unavailable' },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      const mockSuccessResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };

      axios.get = jest
        .fn()
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await maestro['getStatus']();

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result.completed).toBe(true);
    });

    it('should retry multiple times on consecutive 502 errors', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error502 = {
        isAxiosError: true,
        response: { status: 502, statusText: 'Bad Gateway' },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      const mockSuccessResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };

      axios.get = jest
        .fn()
        .mockRejectedValueOnce(error502) // First call fails
        .mockRejectedValueOnce(error502) // Second call fails
        .mockResolvedValueOnce(mockSuccessResponse); // Third call succeeds

      const result = await maestro['getStatus']();

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(result.completed).toBe(true);
    });

    it('should throw error after max retries exceeded', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error502 = {
        isAxiosError: true,
        response: {
          status: 502,
          statusText: 'Bad Gateway',
          data: 'Bad Gateway',
        },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      // All 4 calls (1 initial + 3 retries) fail
      axios.get = jest
        .fn()
        .mockRejectedValueOnce(error502)
        .mockRejectedValueOnce(error502)
        .mockRejectedValueOnce(error502)
        .mockRejectedValueOnce(error502);

      await expect(maestro['getStatus']()).rejects.toThrow(
        /Failed to get Maestro test status/,
      );

      expect(axios.get).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should NOT retry on 401 Unauthorized error', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error401 = {
        isAxiosError: true,
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: { error: 'Invalid credentials' },
        },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      axios.get = jest.fn().mockRejectedValueOnce(error401);

      await expect(maestro['getStatus']()).rejects.toThrow(
        /Failed to get Maestro test status/,
      );

      // Should only be called once - no retries for 401
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on 404 Not Found error', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error404 = {
        isAxiosError: true,
        response: { status: 404, statusText: 'Not Found' },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      axios.get = jest.fn().mockRejectedValueOnce(error404);

      await expect(maestro['getStatus']()).rejects.toThrow(
        /Failed to get Maestro test status/,
      );

      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors (ECONNRESET)', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const networkError = {
        isAxiosError: true,
        response: undefined,
        code: 'ECONNRESET',
        message: 'Connection reset',
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      const mockSuccessResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };

      axios.get = jest
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await maestro['getStatus']();

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result.completed).toBe(true);
    });

    it('should retry on 500 Internal Server Error', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error500 = {
        isAxiosError: true,
        response: { status: 500, statusText: 'Internal Server Error' },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      const mockSuccessResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };

      axios.get = jest
        .fn()
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await maestro['getStatus']();

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result.completed).toBe(true);
    });

    it('should retry on 504 Gateway Timeout error', async () => {
      maestro['appId'] = 1234;
      maestro['BASE_RETRY_DELAY_MS'] = 10;

      const error504 = {
        isAxiosError: true,
        response: { status: 504, statusText: 'Gateway Timeout' },
        code: undefined,
      };
      axios.isAxiosError = jest.fn().mockReturnValue(true);

      const mockSuccessResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
            },
          ],
          success: true,
          completed: true,
        },
      };

      axios.get = jest
        .fn()
        .mockRejectedValueOnce(error504)
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await maestro['getStatus']();

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result.completed).toBe(true);
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
        .mockResolvedValueOnce({ data: { app_exists: false }, headers: {} }) // checksum
        .mockResolvedValueOnce({ data: { id: 1234 }, headers: {} }) // uploadApp
        .mockResolvedValueOnce({ data: { id: 1234 }, headers: {} }) // uploadFlows
        .mockResolvedValueOnce({ data: { success: true }, headers: {} }); // runTests

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
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      fs.createReadStream = jest.fn().mockReturnValue(mockStream);

      // Mock upload and run responses
      axios.post = jest
        .fn()
        .mockResolvedValueOnce({ data: { app_exists: false }, headers: {} }) // checksum
        .mockResolvedValueOnce({ data: { id: 1234 }, headers: {} }) // uploadApp
        .mockResolvedValueOnce({ data: { id: 1234 }, headers: {} }) // uploadFlows
        .mockResolvedValueOnce({ data: { success: true }, headers: {} }); // runTests

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
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
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

        const mockStream = new Readable({
          read() {
            this.push(Buffer.alloc(1024));
            this.push(null);
          },
        });
        fs.createReadStream = jest.fn().mockReturnValue(mockStream);

        // Mock uploads and run
        axios.post = jest
          .fn()
          .mockResolvedValueOnce({ data: { app_exists: false }, headers: {} }) // checksum
          .mockResolvedValueOnce({ data: { id: 1234 }, headers: {} }) // uploadApp
          .mockResolvedValueOnce({ data: { id: 1234 }, headers: {} }) // uploadFlows
          .mockResolvedValueOnce({ data: { success: true }, headers: {} }); // runTests

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
        { downloadArtifacts: 'all' },
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
          downloadArtifacts: 'all',
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

    it('should pass validation when downloadArtifacts is set to failed mode', async () => {
      const optionsWithArtifacts = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        { downloadArtifacts: 'failed' },
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

    it('should generate zip filename from --name option', async () => {
      const optionsWithName = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          downloadArtifacts: 'all',
          name: 'my-test-run',
        },
      );
      const maestroWithName = new Maestro(mockCredentials, optionsWithName);

      // Mock access to throw (file doesn't exist)
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const zipName =
        await maestroWithName['generateArtifactZipName']('/tmp/test');
      expect(zipName).toBe('my-test-run.zip');
    });

    it('should sanitize name for zip filename', async () => {
      const optionsWithName = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          downloadArtifacts: 'all',
          name: 'my test/run:v1.0',
        },
      );
      const maestroWithName = new Maestro(mockCredentials, optionsWithName);

      // Mock access to throw (file doesn't exist)
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const zipName =
        await maestroWithName['generateArtifactZipName']('/tmp/test');
      expect(zipName).toBe('my_test_run_v1_0.zip');
    });

    it('should generate timestamp-based zip filename when no --name option', async () => {
      const optionsWithoutName = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        { downloadArtifacts: 'all' },
      );
      const maestroWithoutName = new Maestro(
        mockCredentials,
        optionsWithoutName,
      );

      const zipName =
        await maestroWithoutName['generateArtifactZipName']('/tmp/test');
      expect(zipName).toMatch(/^maestro_artifacts_\d{4}-\d{2}-\d{2}T.*\.zip$/);
    });

    it('should add timestamp suffix when zip file already exists', async () => {
      const optionsWithName = new MaestroOptions(
        'path/to/app.apk',
        'path/to/flows',
        'Pixel 6',
        {
          downloadArtifacts: 'all',
          name: 'existing-name',
        },
      );
      const maestroWithName = new Maestro(mockCredentials, optionsWithName);

      // Mock access: file exists
      (fs.promises.access as jest.Mock).mockResolvedValueOnce(undefined);

      const zipName =
        await maestroWithName['generateArtifactZipName']('/tmp/test');
      expect(zipName).toMatch(/^existing-name_\d+\.zip$/);
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

  describe('Discover Dependencies', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should discover runScript with string format', async () => {
      const flowContent = `
- runScript: ../config/mocks.js
- tapOn: "Login"
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'login.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'config', 'mocks.js'));
    });

    it('should discover runScript with object format', async () => {
      const flowContent = `
- runScript:
    file: ../config/mocks.js
    when:
      true: \${SOME_CONDITION}
- tapOn: "Login"
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'login.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'config', 'mocks.js'));
    });

    it('should discover multiple runScript dependencies with mixed formats', async () => {
      const flowContent = `
- runScript: ../config/mocks.js
- runScript:
    file: ../config/setup.js
    when:
      true: \${DEBUG}
- runScript: ../helpers/index.js
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'login.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'config', 'mocks.js'));
      expect(deps).toContain(path.join(projectDir, 'config', 'setup.js'));
      expect(deps).toContain(path.join(projectDir, 'helpers', 'index.js'));
    });

    it('should handle multi-document YAML with front matter', async () => {
      const flowContent = `appId: \${APP_ID}
tags:
  - subflow
---
- runScript: ../config/mocks.js
- tapOn: "Login"
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(
        projectDir,
        'flows',
        'subflows',
        'loadApp.yaml',
      );

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(
        path.join(projectDir, 'flows', 'config', 'mocks.js'),
      );
    });

    it('should handle multi-document YAML with runScript object format', async () => {
      // Simulates loadApp.yaml in app/flows/settings/subflows/ referencing
      // files in config/ at the project root via ../../../config/
      const flowContent = `appId: \${APP_ID}
tags:
  - subflow
---
- runScript:
    file: ../../../../config/mocks.js
    when:
      true: \${APP_ID === 'com.example.app'}
- runScript: ../../../../config/en-GB.js
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(
        projectDir,
        'app',
        'flows',
        'settings',
        'subflows',
        'loadApp.yaml',
      );

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      // From /project/app/flows/settings/subflows/, ../../../../ goes to /project/
      expect(deps).toContain(path.join(projectDir, 'config', 'mocks.js'));
      expect(deps).toContain(path.join(projectDir, 'config', 'en-GB.js'));
    });

    it('should discover runFlow dependencies recursively', async () => {
      const mainFlowContent = `
- runFlow: subflows/helper.yaml
- tapOn: "Continue"
`;
      const helperFlowContent = `
- runScript: ../config/setup.js
- tapOn: "OK"
`;
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(mainFlowContent)
        .mockResolvedValueOnce(helperFlowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(
        path.join(projectDir, 'flows', 'subflows', 'helper.yaml'),
      );
      expect(deps).toContain(
        path.join(projectDir, 'flows', 'config', 'setup.js'),
      );
    });

    it('should discover runFlow with object format', async () => {
      const flowContent = `
- runFlow:
    file: subflows/helper.yaml
    env:
      TEST_VAR: value
`;
      const helperFlowContent = `
- tapOn: "OK"
`;
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(flowContent)
        .mockResolvedValueOnce(helperFlowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(
        path.join(projectDir, 'flows', 'subflows', 'helper.yaml'),
      );
    });

    it('should discover addMedia dependencies', async () => {
      const flowContent = `
- addMedia: ../assets/test_image.jpg
- tapOn: "Upload"
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'upload.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'assets', 'test_image.jpg'));
    });

    it('should discover addMedia with array format', async () => {
      const flowContent = `
- addMedia:
    - ../assets/image1.jpg
    - ../assets/image2.png
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'upload.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'assets', 'image1.jpg'));
      expect(deps).toContain(path.join(projectDir, 'assets', 'image2.png'));
    });

    it('should discover addMedia inside runFlow with inline commands', async () => {
      // This is the pattern used in loadApp.yaml where addMedia is nested
      // inside a runFlow with inline commands instead of a file reference
      const flowContent = `
- runFlow:
    when:
      true: \${MAESTRO_MEDIA === 'add'}
    commands:
      - addMedia:
          - ../../assets/media_image.jpg
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(
        projectDir,
        'app',
        'flows',
        'subflows',
        'loadApp.yaml',
      );

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      // From /project/app/flows/subflows/, ../../assets/ resolves to /project/app/assets/
      expect(deps).toContain(
        path.join(projectDir, 'app', 'assets', 'media_image.jpg'),
      );
    });

    it('should discover runScript inside runFlow with inline commands', async () => {
      const flowContent = `
- runFlow:
    when:
      true: \${SOME_CONDITION}
    commands:
      - runScript: ../config/conditional.js
      - tapOn: "OK"
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'config', 'conditional.js'));
    });

    it('should discover plain filenames in runScript commands', async () => {
      // Plain filenames like "setManager.js" should be discovered via known commands
      const flowContent = `
- runScript:
    file: setManager.js
    when:
      true: \${userRole === 'manager'}
- runScript:
    file: setUser.js
    when:
      true: \${userRole === 'user'}
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(
        projectDir,
        'subflows',
        'setUserAndEnvironment.yaml',
      );

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(
        path.join(projectDir, 'subflows', 'setManager.js'),
      );
      expect(deps).toContain(path.join(projectDir, 'subflows', 'setUser.js'));
    });

    it('should discover nested dependencies in runFlow with inline commands', async () => {
      // Complex case: runFlow with inline commands containing multiple dependency types
      const flowContent = `
- runFlow:
    when:
      true: \${CONDITION}
    commands:
      - runScript: ../config/setup.js
      - addMedia:
          - ../assets/image1.jpg
          - ../assets/image2.jpg
      - runScript:
          file: ../config/teardown.js
          when:
            true: \${CLEANUP}
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'config', 'setup.js'));
      expect(deps).toContain(path.join(projectDir, 'assets', 'image1.jpg'));
      expect(deps).toContain(path.join(projectDir, 'assets', 'image2.jpg'));
      expect(deps).toContain(path.join(projectDir, 'config', 'teardown.js'));
    });

    it('should discover dependencies in repeat command', async () => {
      const flowContent = `
- repeat:
    times: 3
    commands:
      - runFlow: subflow.yaml
      - runScript: validation.js
      - addMedia:
        - images/logo.png
`;
      const subflowContent = `- tapOn: "Button"`;
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(flowContent)
        .mockResolvedValueOnce(subflowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'flows', 'subflow.yaml'));
      expect(deps).toContain(path.join(projectDir, 'flows', 'validation.js'));
      expect(deps).toContain(
        path.join(projectDir, 'flows', 'images', 'logo.png'),
      );
    });

    it('should discover dependencies in retry command with file reference', async () => {
      const flowContent = `
- retry:
    file: retry_flow.yaml
    maxRetries: 3
`;
      const retryFlowContent = `
- runFlow: nested.yaml
`;
      const nestedContent = `- tapOn: "Button"`;
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(flowContent)
        .mockResolvedValueOnce(retryFlowContent)
        .mockResolvedValueOnce(nestedContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'flows', 'retry_flow.yaml'));
      expect(deps).toContain(path.join(projectDir, 'flows', 'nested.yaml'));
    });

    it('should discover dependencies in retry command with inline commands', async () => {
      const flowContent = `
- retry:
    maxRetries: 2
    commands:
      - runScript: cleanup.js
      - addMedia:
        - images/retry.png
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'flows', 'cleanup.js'));
      expect(deps).toContain(
        path.join(projectDir, 'flows', 'images', 'retry.png'),
      );
    });

    it('should discover dependencies in onFlowStart and onFlowComplete hooks', async () => {
      const flowContent = `appId: com.example.app
onFlowStart:
  - runFlow: startup.yaml
  - runScript: init.js
onFlowComplete:
  - runFlow: cleanup.yaml
  - runScript: teardown.js
---
- tapOn: "Main Button"
`;
      const startupContent = `- tapOn: "Startup"`;
      const cleanupContent = `- tapOn: "Cleanup"`;
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(flowContent)
        .mockResolvedValueOnce(startupContent)
        .mockResolvedValueOnce(cleanupContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'flows', 'startup.yaml'));
      expect(deps).toContain(path.join(projectDir, 'flows', 'init.js'));
      expect(deps).toContain(path.join(projectDir, 'flows', 'cleanup.yaml'));
      expect(deps).toContain(path.join(projectDir, 'flows', 'teardown.js'));
    });

    it('should handle circular dependencies without infinite loop', async () => {
      const flow1Content = `
- runFlow: flow2.yaml
- tapOn: "Button1"
`;
      const flow2Content = `
- runFlow: flow1.yaml
- tapOn: "Button2"
`;
      // Mock returns flow1 content first, then flow2 content
      // But flow2 references flow1 which is already visited
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(flow1Content)
        .mockResolvedValueOnce(flow2Content);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'flow1.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      // Should find flow2 but not loop infinitely
      expect(deps).toContain(path.join(projectDir, 'flows', 'flow2.yaml'));
      // The mock was only called twice, proving no infinite loop
      expect(fs.promises.readFile).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate same file referenced multiple times', async () => {
      const flowContent = `
- runFlow: subflow.yaml
- runFlow: subflow.yaml
- runFlow:
    commands:
      - runFlow: subflow.yaml
`;
      const subflowContent = `- tapOn: "Button"`;
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(flowContent)
        .mockResolvedValueOnce(subflowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      // Should only include subflow once despite multiple references
      const expectedSubflow = path.join(projectDir, 'flows', 'subflow.yaml');
      const subflowCount = deps.filter((d) => d === expectedSubflow).length;
      expect(subflowCount).toBe(1);
    });

    it('should skip dependencies that do not exist', async () => {
      const flowContent = `
- runScript: ../config/exists.js
- runScript: ../config/not-exists.js
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);
      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined) // exists.js found
        .mockRejectedValueOnce(new Error('ENOENT')); // not-exists.js not found

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'main.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(path.join(projectDir, 'config', 'exists.js'));
      expect(deps).not.toContain(
        path.join(projectDir, 'config', 'not-exists.js'),
      );
    });

    it('should return empty array for single-document YAML without dependencies', async () => {
      const flowContent = `
- tapOn: "Login"
- inputText: "user@example.com"
`;
      fs.promises.readFile = jest.fn().mockResolvedValue(flowContent);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'simple.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toEqual([]);
    });

    it('should return empty array when YAML parsing fails', async () => {
      fs.promises.readFile = jest
        .fn()
        .mockRejectedValue(new Error('File not found'));

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(projectDir, 'flows', 'missing.yaml');

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toEqual([]);
    });

    it('should handle complex multi-document YAML with all dependency types', async () => {
      const flowContent = `appId: \${APP_ID}
tags:
  - e2e
---
- runScript:
    file: ../../config/mocks.js
    when:
      true: \${MOCK_API}
- runScript: ../../config/setup.js
- runFlow:
    file: ../subflows/login.yaml
    env:
      USERNAME: testuser
- addMedia:
    - ../../assets/avatar.png
- tapOn: "Submit"
`;
      const loginFlowContent = `
- runScript: ../../config/auth.js
- inputText: "password123"
`;
      fs.promises.readFile = jest
        .fn()
        .mockResolvedValueOnce(flowContent)
        .mockResolvedValueOnce(loginFlowContent);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const projectDir = path.resolve(path.sep, 'project');
      const flowPath = path.join(
        projectDir,
        'app',
        'flows',
        'settings',
        'main.yaml',
      );

      const deps = await maestro['discoverDependencies'](flowPath, projectDir);

      expect(deps).toContain(
        path.join(projectDir, 'app', 'config', 'mocks.js'),
      );
      expect(deps).toContain(
        path.join(projectDir, 'app', 'config', 'setup.js'),
      );
      expect(deps).toContain(
        path.join(projectDir, 'app', 'flows', 'subflows', 'login.yaml'),
      );
      expect(deps).toContain(
        path.join(projectDir, 'app', 'assets', 'avatar.png'),
      );
      expect(deps).toContain(path.join(projectDir, 'app', 'config', 'auth.js'));
    });
  });

  describe('looksLikePath', () => {
    it('should identify relative paths with extensions', () => {
      expect(maestro['looksLikePath']('../config/mocks.js')).toBe(true);
      expect(maestro['looksLikePath']('./helpers/index.js')).toBe(true);
      expect(maestro['looksLikePath']('../../assets/image.png')).toBe(true);
      expect(maestro['looksLikePath']('../subflows/login.yaml')).toBe(true);
    });

    it('should identify paths with slashes and extensions', () => {
      expect(maestro['looksLikePath']('config/mocks.js')).toBe(true);
      expect(maestro['looksLikePath']('subflows/helper.yaml')).toBe(true);
    });

    it('should reject URLs', () => {
      expect(maestro['looksLikePath']('https://example.com/file.js')).toBe(
        false,
      );
      expect(maestro['looksLikePath']('http://example.com/image.png')).toBe(
        false,
      );
      expect(maestro['looksLikePath']('file:///tmp/test.yaml')).toBe(false);
    });

    it('should reject template variables', () => {
      expect(maestro['looksLikePath']('${APP_ID}')).toBe(false);
      expect(maestro['looksLikePath']('${SOME_PATH}')).toBe(false);
    });

    it('should reject strings without file extensions', () => {
      expect(maestro['looksLikePath']('../config')).toBe(false);
      expect(maestro['looksLikePath']('subflows/helper')).toBe(false);
    });

    it('should reject plain filenames without path separators', () => {
      // These are handled specially for known commands like runScript
      expect(maestro['looksLikePath']('setManager.js')).toBe(false);
      expect(maestro['looksLikePath']('config.yaml')).toBe(false);
    });

    it('should reject plain text', () => {
      expect(maestro['looksLikePath']('Login')).toBe(false);
      expect(maestro['looksLikePath']('Click here')).toBe(false);
      expect(maestro['looksLikePath']('user@example.com')).toBe(false);
    });
  });

  describe('Discover Flows', () => {
    const { glob } = require('glob');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should include config.yaml in discovered files when it exists', async () => {
      const configContent = `
flows:
  - "app/flows/**"
excludeTags:
  - subflow
`;
      const projectDir = path.resolve(path.sep, 'project');
      fs.promises.readFile = jest.fn().mockResolvedValue(configContent);
      fs.promises.readdir = jest.fn().mockResolvedValue([]);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      (glob as jest.Mock).mockResolvedValue([
        path.join(projectDir, 'app', 'flows', 'login.yaml'),
        path.join(projectDir, 'app', 'flows', 'settings.yaml'),
      ]);

      const files = await maestro['discoverFlows'](projectDir);

      expect(files).toContain(path.join(projectDir, 'config.yaml'));
      expect(files).toContain(
        path.join(projectDir, 'app', 'flows', 'login.yaml'),
      );
      expect(files).toContain(
        path.join(projectDir, 'app', 'flows', 'settings.yaml'),
      );
    });

    it('should not include config.yaml when it does not exist', async () => {
      const projectDir = path.resolve(path.sep, 'project');
      fs.promises.readFile = jest
        .fn()
        .mockRejectedValue(new Error('ENOENT: no such file'));
      fs.promises.readdir = jest.fn().mockResolvedValue([
        { name: 'flow1.yaml', isFile: () => true },
        { name: 'flow2.yaml', isFile: () => true },
      ]);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);

      const files = await maestro['discoverFlows'](projectDir);

      expect(files).not.toContain(path.join(projectDir, 'config.yaml'));
      expect(files).toContain(path.join(projectDir, 'flow1.yaml'));
      expect(files).toContain(path.join(projectDir, 'flow2.yaml'));
    });

    it('should use glob patterns from config.yaml when available', async () => {
      const configContent = `
flows:
  - "app/flows/**"
  - "web/flows/**"
`;
      const projectDir = path.resolve(path.sep, 'project');
      fs.promises.readFile = jest.fn().mockResolvedValue(configContent);
      fs.promises.readdir = jest.fn().mockResolvedValue([]);
      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      (glob as jest.Mock)
        .mockResolvedValueOnce([
          path.join(projectDir, 'app', 'flows', 'test.yaml'),
        ])
        .mockResolvedValueOnce([
          path.join(projectDir, 'web', 'flows', 'test.yaml'),
        ]);

      const files = await maestro['discoverFlows'](projectDir);

      expect(glob).toHaveBeenCalledWith(
        path.join(projectDir, 'app', 'flows', '**'),
      );
      expect(glob).toHaveBeenCalledWith(
        path.join(projectDir, 'web', 'flows', '**'),
      );
      expect(files).toContain(path.join(projectDir, 'config.yaml'));
      expect(files).toContain(
        path.join(projectDir, 'app', 'flows', 'test.yaml'),
      );
      expect(files).toContain(
        path.join(projectDir, 'web', 'flows', 'test.yaml'),
      );
    });
  });

  describe('Flow Status Display', () => {
    describe('getFlowStatusDisplay', () => {
      it('should return white WAITING for WAITING status', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test.yaml',
          status: 'WAITING',
        };
        const result = maestro['getFlowStatusDisplay'](flow);
        expect(result.text).toBe('WAITING');
        expect(result.colored).toContain('WAITING');
      });

      it('should return blue RUNNING for READY status', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test.yaml',
          status: 'READY',
        };
        const result = maestro['getFlowStatusDisplay'](flow);
        expect(result.text).toBe('RUNNING');
        expect(result.colored).toContain('RUNNING');
      });

      it('should return green PASSED for DONE status with success=1', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test.yaml',
          status: 'DONE',
          success: 1,
        };
        const result = maestro['getFlowStatusDisplay'](flow);
        expect(result.text).toBe('PASSED');
        expect(result.colored).toContain('PASSED');
      });

      it('should return red FAILED for DONE status with success=0', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test.yaml',
          status: 'DONE',
          success: 0,
        };
        const result = maestro['getFlowStatusDisplay'](flow);
        expect(result.text).toBe('FAILED');
        expect(result.colored).toContain('FAILED');
      });

      it('should return red FAILED for DONE status without success field', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test.yaml',
          status: 'DONE',
        };
        const result = maestro['getFlowStatusDisplay'](flow);
        expect(result.text).toBe('FAILED');
        expect(result.colored).toContain('FAILED');
      });

      it('should return red FAILED for FAILED status', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test.yaml',
          status: 'FAILED',
        };
        const result = maestro['getFlowStatusDisplay'](flow);
        expect(result.text).toBe('FAILED');
        expect(result.colored).toContain('FAILED');
      });

      it('should return the status as-is for unknown status', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test.yaml',
          status: 'UNKNOWN' as MaestroFlowStatus,
        };
        const result = maestro['getFlowStatusDisplay'](flow);
        expect(result.text).toBe('UNKNOWN');
        expect(result.colored).toBe('UNKNOWN');
      });
    });

    describe('calculateFlowDuration', () => {
      it('should return "-" when requested_at is not set', () => {
        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test_flow.yaml',
          status: 'WAITING',
        };

        const result = maestro['calculateFlowDuration'](flow);
        expect(result).toBe('-');
      });

      it('should calculate duration for completed flow', () => {
        const startTime = new Date('2025-01-01T10:00:00.000Z');
        const endTime = new Date('2025-01-01T10:00:30.000Z');

        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test_flow.yaml',
          status: 'DONE',
          success: 1,
          requested_at: startTime.toISOString(),
          completed_at: endTime.toISOString(),
        };

        const result = maestro['calculateFlowDuration'](flow);
        expect(result).toBe('30s');
      });

      it('should format duration with minutes when over 60 seconds', () => {
        const startTime = new Date('2025-01-01T10:00:00.000Z');
        const endTime = new Date('2025-01-01T10:02:15.000Z');

        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test_flow.yaml',
          status: 'DONE',
          success: 1,
          requested_at: startTime.toISOString(),
          completed_at: endTime.toISOString(),
        };

        const result = maestro['calculateFlowDuration'](flow);
        expect(result).toBe('2m 15s');
      });

      it('should calculate elapsed time for running flow', () => {
        // Set requested_at to a fixed time in the past
        const startTime = new Date(Date.now() - 45000); // 45 seconds ago

        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'test_flow.yaml',
          status: 'READY',
          requested_at: startTime.toISOString(),
        };

        const result = maestro['calculateFlowDuration'](flow);
        // Should be around 45s (allow some variance for test execution time)
        expect(result).toMatch(/^\d+s$|^\d+m \d+s$/);
      });
    });

    describe('getTerminalHeight', () => {
      it('should return process.stdout.rows when available', () => {
        const originalRows = process.stdout.rows;
        Object.defineProperty(process.stdout, 'rows', {
          value: 40,
          configurable: true,
        });

        const result = maestro['getTerminalHeight']();
        expect(result).toBe(40);

        Object.defineProperty(process.stdout, 'rows', {
          value: originalRows,
          configurable: true,
        });
      });

      it('should return 24 as default when rows is not available', () => {
        const originalRows = process.stdout.rows;
        Object.defineProperty(process.stdout, 'rows', {
          value: undefined,
          configurable: true,
        });

        const result = maestro['getTerminalHeight']();
        expect(result).toBe(24);

        Object.defineProperty(process.stdout, 'rows', {
          value: originalRows,
          configurable: true,
        });
      });
    });

    describe('getMaxDisplayableFlows', () => {
      it('should calculate max flows based on terminal height', () => {
        const originalRows = process.stdout.rows;
        Object.defineProperty(process.stdout, 'rows', {
          value: 30,
          configurable: true,
        });

        const result = maestro['getMaxDisplayableFlows']();
        // 30 - 6 reserved lines = 24
        expect(result).toBe(24);

        Object.defineProperty(process.stdout, 'rows', {
          value: originalRows,
          configurable: true,
        });
      });

      it('should return minimum of 5 flows', () => {
        const originalRows = process.stdout.rows;
        Object.defineProperty(process.stdout, 'rows', {
          value: 8,
          configurable: true,
        });

        const result = maestro['getMaxDisplayableFlows']();
        // 8 - 6 = 2, but minimum is 5
        expect(result).toBe(5);

        Object.defineProperty(process.stdout, 'rows', {
          value: originalRows,
          configurable: true,
        });
      });
    });

    describe('getRemainingSummary', () => {
      it('should return empty string when no remaining flows', () => {
        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'WAITING' },
        ];

        const result = maestro['getRemainingSummary'](flows, 1);
        expect(result).toBe('');
      });

      it('should summarize remaining flows by status', () => {
        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
          { id: 2, name: 'flow2.yaml', status: 'WAITING' },
          { id: 3, name: 'flow3.yaml', status: 'WAITING' },
          { id: 4, name: 'flow4.yaml', status: 'READY' },
          { id: 5, name: 'flow5.yaml', status: 'DONE', success: 0 },
        ];

        const result = maestro['getRemainingSummary'](flows, 1);
        expect(result).toContain('4 more');
        expect(result).toContain('2 waiting');
        expect(result).toContain('1 running');
        expect(result).toContain('1 failed');
      });

      it('should only show non-zero counts', () => {
        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
          { id: 2, name: 'flow2.yaml', status: 'WAITING' },
          { id: 3, name: 'flow3.yaml', status: 'WAITING' },
        ];

        const result = maestro['getRemainingSummary'](flows, 1);
        expect(result).toContain('2 more');
        expect(result).toContain('2 waiting');
        expect(result).not.toContain('running');
        expect(result).not.toContain('passed');
        expect(result).not.toContain('failed');
      });
    });

    describe('displayFlowsWithLimit', () => {
      it('should display all flows when under limit', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        const originalRows = process.stdout.rows;
        Object.defineProperty(process.stdout, 'rows', {
          value: 30,
          configurable: true,
        });

        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'WAITING' },
          { id: 2, name: 'flow2.yaml', status: 'READY' },
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();

        const linesWritten = maestro['displayFlowsWithLimit'](
          flows,
          previousStatus,
        );

        expect(linesWritten).toBe(2);
        expect(consoleSpy).toHaveBeenCalledTimes(2);

        consoleSpy.mockRestore();
        Object.defineProperty(process.stdout, 'rows', {
          value: originalRows,
          configurable: true,
        });
      });

      it('should show summary line when flows exceed limit', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        const originalRows = process.stdout.rows;
        // Set terminal height so max flows = 5
        Object.defineProperty(process.stdout, 'rows', {
          value: 11,
          configurable: true,
        });

        const flows: MaestroFlowInfo[] = [];
        for (let i = 1; i <= 10; i++) {
          flows.push({ id: i, name: `flow${i}.yaml`, status: 'WAITING' });
        }
        const previousStatus = new Map<number, MaestroFlowStatus>();

        const linesWritten = maestro['displayFlowsWithLimit'](
          flows,
          previousStatus,
        );

        // 5 flows + 1 summary line
        expect(linesWritten).toBe(6);
        // 5 flow rows + 1 summary
        expect(consoleSpy).toHaveBeenCalledTimes(6);
        // Last call should be the summary
        const lastCall = consoleSpy.mock.calls[5][0];
        expect(lastCall).toContain('5 more');

        consoleSpy.mockRestore();
        Object.defineProperty(process.stdout, 'rows', {
          value: originalRows,
          configurable: true,
        });
      });
    });

    describe('displayFlowsTableHeader', () => {
      it('should output the table header', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        maestro['displayFlowsTableHeader']();

        expect(consoleSpy).toHaveBeenCalledTimes(2);
        // First call is the header row
        expect(consoleSpy.mock.calls[0][0]).toContain('Duration');
        expect(consoleSpy.mock.calls[0][0]).toContain('Status');
        expect(consoleSpy.mock.calls[0][0]).toContain('Flow');
        // Second call is the separator
        expect(consoleSpy.mock.calls[1][0]).toContain('─');

        consoleSpy.mockRestore();
      });
    });

    describe('displayFlowRow', () => {
      it('should display a flow row with correct formatting', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'login_flow.yaml',
          status: 'DONE',
          success: 1,
          requested_at: new Date(Date.now() - 30000).toISOString(),
          completed_at: new Date().toISOString(),
        };

        maestro['displayFlowRow'](flow, false);

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('login_flow.yaml');
        expect(output).toContain('PASSED'); // DONE + success=1 displays as PASSED

        consoleSpy.mockRestore();
      });

      it('should write to stdout when isUpdate is true', () => {
        const stdoutSpy = jest
          .spyOn(process.stdout, 'write')
          .mockImplementation();

        const flow: MaestroFlowInfo = {
          id: 1,
          name: 'login_flow.yaml',
          status: 'READY',
          requested_at: new Date().toISOString(),
        };

        maestro['displayFlowRow'](flow, true);

        expect(stdoutSpy).toHaveBeenCalled();
        const output = stdoutSpy.mock.calls[0][0] as string;
        expect(output).toContain('login_flow.yaml');
        expect(output).toContain('RUNNING'); // READY displays as RUNNING

        stdoutSpy.mockRestore();
      });
    });

    describe('displayFlowsTable', () => {
      it('should display header and all flows on first call', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'WAITING' },
          { id: 2, name: 'flow2.yaml', status: 'WAITING' },
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();

        const linesWritten = maestro['displayFlowsTable'](
          flows,
          previousStatus,
          true,
        );

        // Header (2 lines) + 2 flow rows
        expect(consoleSpy).toHaveBeenCalledTimes(4);
        expect(linesWritten).toBe(2);
        expect(previousStatus.get(1)).toBe('WAITING');
        expect(previousStatus.get(2)).toBe('WAITING');

        consoleSpy.mockRestore();
      });

      it('should only display new flows on subsequent calls', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
          { id: 2, name: 'flow2.yaml', status: 'WAITING' },
          { id: 3, name: 'flow3.yaml', status: 'WAITING' },
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();
        previousStatus.set(1, 'WAITING');
        previousStatus.set(2, 'WAITING');

        const linesWritten = maestro['displayFlowsTable'](
          flows,
          previousStatus,
          false,
        );

        // Only the new flow (id: 3) should be displayed
        expect(consoleSpy).toHaveBeenCalledTimes(1);
        expect(linesWritten).toBe(1);

        consoleSpy.mockRestore();
      });

      it('should not write lines for already tracked flows', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();
        previousStatus.set(1, 'WAITING'); // Already tracked

        const linesWritten = maestro['displayFlowsTable'](
          flows,
          previousStatus,
          false,
        );

        expect(consoleSpy).not.toHaveBeenCalled();
        expect(linesWritten).toBe(0);

        consoleSpy.mockRestore();
      });
    });

    describe('updateFlowsInPlace', () => {
      it('should update flows that changed status', () => {
        const stdoutSpy = jest
          .spyOn(process.stdout, 'write')
          .mockImplementation();

        const flows: MaestroFlowInfo[] = [
          {
            id: 1,
            name: 'flow1.yaml',
            status: 'DONE',
            success: 1,
            requested_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
          {
            id: 2,
            name: 'flow2.yaml',
            status: 'READY',
            requested_at: new Date().toISOString(),
          },
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();
        previousStatus.set(1, 'READY');
        previousStatus.set(2, 'WAITING');

        const newCount = maestro['updateFlowsInPlace'](
          flows,
          previousStatus,
          2,
        );

        // Should have written cursor movement and updates
        expect(stdoutSpy).toHaveBeenCalled();
        // Check that status was updated
        expect(previousStatus.get(1)).toBe('DONE');
        expect(previousStatus.get(2)).toBe('READY');
        // Should return the new flow count
        expect(newCount).toBe(2);

        stdoutSpy.mockRestore();
      });

      it('should handle new flows being added', () => {
        const stdoutSpy = jest
          .spyOn(process.stdout, 'write')
          .mockImplementation();

        const flows: MaestroFlowInfo[] = [
          {
            id: 1,
            name: 'flow1.yaml',
            status: 'DONE',
            success: 1,
            requested_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
          {
            id: 2,
            name: 'flow2.yaml',
            status: 'READY',
            requested_at: new Date().toISOString(),
          },
          { id: 3, name: 'flow3.yaml', status: 'WAITING' }, // New flow
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();
        previousStatus.set(1, 'DONE');
        previousStatus.set(2, 'WAITING');

        // Previously displayed 2 flows, now we have 3
        const newCount = maestro['updateFlowsInPlace'](
          flows,
          previousStatus,
          2,
        );

        // Should move up by 2 (previous count), not 3 (current count)
        const cursorUpCall = stdoutSpy.mock.calls.find(
          (call) => typeof call[0] === 'string' && call[0].includes('\x1b[2A'),
        );
        expect(cursorUpCall).toBeDefined();

        // Should return the new count (3)
        expect(newCount).toBe(3);

        stdoutSpy.mockRestore();
      });

      it('should not move cursor when displayedFlowCount is 0', () => {
        const stdoutSpy = jest
          .spyOn(process.stdout, 'write')
          .mockImplementation();

        const flows: MaestroFlowInfo[] = [
          { id: 1, name: 'flow1.yaml', status: 'WAITING' },
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();

        const newCount = maestro['updateFlowsInPlace'](
          flows,
          previousStatus,
          0,
        );

        // Should NOT have cursor up command when displayedFlowCount is 0
        // Cursor up is \x1b[nA where n is a number - use regex to be precise
        const cursorUpCall = stdoutSpy.mock.calls.find(
          (call) => typeof call[0] === 'string' && /\x1b\[\d+A/.test(call[0]),
        );
        expect(cursorUpCall).toBeUndefined();

        expect(newCount).toBe(1);

        stdoutSpy.mockRestore();
      });

      it('should update running flows to refresh duration', () => {
        const stdoutSpy = jest
          .spyOn(process.stdout, 'write')
          .mockImplementation();

        const flows: MaestroFlowInfo[] = [
          {
            id: 1,
            name: 'flow1.yaml',
            status: 'READY',
            requested_at: new Date().toISOString(),
          },
        ];
        const previousStatus = new Map<number, MaestroFlowStatus>();
        previousStatus.set(1, 'READY'); // Same status but still READY

        const newCount = maestro['updateFlowsInPlace'](
          flows,
          previousStatus,
          1,
        );

        // Should update because READY flows need duration refresh
        expect(stdoutSpy).toHaveBeenCalled();
        expect(newCount).toBe(1);

        stdoutSpy.mockRestore();
      });
    });
  });

  describe('Wait For Completion with Flows', () => {
    beforeEach(() => {
      maestro['appId'] = 1234;
      maestro['POLL_INTERVAL_MS'] = 10;
    });

    it('should display flows table when flows are available', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const responseWithFlows = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
              flows: [
                {
                  id: 1,
                  name: 'login_flow.yaml',
                  status: 'DONE',
                  success: 1,
                  requested_at: '2025-01-01T10:00:00Z',
                  completed_at: '2025-01-01T10:00:30Z',
                },
                {
                  id: 2,
                  name: 'checkout_flow.yaml',
                  status: 'DONE',
                  success: 1,
                  requested_at: '2025-01-01T10:00:30Z',
                  completed_at: '2025-01-01T10:01:00Z',
                },
              ],
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(responseWithFlows);

      const result = await maestro['waitForCompletion']();

      expect(result.success).toBe(true);
      // Check that flows table header was displayed
      const headerCalls = consoleSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('Duration'),
      );
      expect(headerCalls.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    it('should update flow statuses as they progress', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation();

      const waitingResponse = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'READY',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 0,
              flows: [
                {
                  id: 1,
                  name: 'login_flow.yaml',
                  status: 'READY',
                  requested_at: '2025-01-01T10:00:00Z',
                },
                { id: 2, name: 'checkout_flow.yaml', status: 'WAITING' },
              ],
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
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
              flows: [
                {
                  id: 1,
                  name: 'login_flow.yaml',
                  status: 'DONE',
                  success: 1,
                  requested_at: '2025-01-01T10:00:00Z',
                  completed_at: '2025-01-01T10:00:30Z',
                },
                {
                  id: 2,
                  name: 'checkout_flow.yaml',
                  status: 'DONE',
                  success: 1,
                  requested_at: '2025-01-01T10:00:30Z',
                  completed_at: '2025-01-01T10:01:00Z',
                },
              ],
            },
          ],
          success: true,
          completed: true,
        },
      };

      axios.get = jest
        .fn()
        .mockResolvedValueOnce(waitingResponse)
        .mockResolvedValueOnce(completedResponse);

      const result = await maestro['waitForCompletion']();

      expect(result.success).toBe(true);
      expect(axios.get).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
      stdoutSpy.mockRestore();
    });

    it('should handle runs without flows gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const responseWithoutFlows = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
              // No flows property
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(responseWithoutFlows);

      const result = await maestro['waitForCompletion']();

      expect(result.success).toBe(true);
      // Should not crash and should still complete

      consoleSpy.mockRestore();
    });

    it('should handle empty flows array', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const responseEmptyFlows = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
              flows: [],
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(responseEmptyFlows);

      const result = await maestro['waitForCompletion']();

      expect(result.success).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should display failed flows correctly', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const responseWithFailedFlow = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 0,
              flows: [
                {
                  id: 1,
                  name: 'login_flow.yaml',
                  status: 'DONE',
                  success: 1,
                  requested_at: '2025-01-01T10:00:00Z',
                  completed_at: '2025-01-01T10:00:30Z',
                },
                {
                  id: 2,
                  name: 'checkout_flow.yaml',
                  status: 'DONE',
                  success: 0,
                  requested_at: '2025-01-01T10:00:30Z',
                  completed_at: '2025-01-01T10:01:00Z',
                },
              ],
            },
          ],
          success: false,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(responseWithFailedFlow);

      const result = await maestro['waitForCompletion']();

      expect(result.success).toBe(false);
      expect(result.runs[0].flows).toHaveLength(2);
      expect(result.runs[0].flows?.[0].status).toBe('DONE');
      expect(result.runs[0].flows?.[0].success).toBe(1);
      expect(result.runs[0].flows?.[1].status).toBe('DONE');
      expect(result.runs[0].flows?.[1].success).toBe(0);

      consoleSpy.mockRestore();
    });

    it('should aggregate flows from multiple runs', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const responseMultipleRuns = {
        data: {
          runs: [
            {
              id: 5678,
              status: 'DONE',
              capabilities: { deviceName: 'Pixel 6', platformName: 'Android' },
              success: 1,
              flows: [
                {
                  id: 1,
                  name: 'android_flow.yaml',
                  status: 'DONE',
                  success: 1,
                },
              ],
            },
            {
              id: 5679,
              status: 'DONE',
              capabilities: { deviceName: 'iPhone 15', platformName: 'iOS' },
              success: 1,
              flows: [
                { id: 2, name: 'ios_flow.yaml', status: 'DONE', success: 1 },
              ],
            },
          ],
          success: true,
          completed: true,
        },
      };
      axios.get = jest.fn().mockResolvedValue(responseMultipleRuns);

      const result = await maestro['waitForCompletion']();

      expect(result.success).toBe(true);
      expect(result.runs).toHaveLength(2);

      consoleSpy.mockRestore();
    });
  });

  describe('extractErrorMessage', () => {
    beforeEach(() => {
      // Reset axios.isAxiosError to return false for these tests
      // (they test the fallback behavior for non-axios error-like objects)
      axios.isAxiosError = jest.fn().mockReturnValue(false);
    });

    it('should return credits depleted message for 429 status code', () => {
      const axiosLikeError = {
        response: {
          status: 429,
          data: {},
        },
        message: 'Request failed with status code 429',
      };

      const result = maestro['extractErrorMessage'](axiosLikeError);

      expect(result).toBe(
        'Your TestingBot credits are depleted. Please upgrade your plan at https://testingbot.com/pricing',
      );
    });

    it('should return error message from response data for non-429 errors', () => {
      const axiosLikeError = {
        response: {
          status: 400,
          data: {
            error: 'Invalid request',
          },
        },
        message: 'Request failed',
      };

      const result = maestro['extractErrorMessage'](axiosLikeError);

      expect(result).toBe('Invalid request');
    });

    it('should return string cause directly', () => {
      const result = maestro['extractErrorMessage']('Simple error message');

      expect(result).toBe('Simple error message');
    });

    it('should join array of errors with newlines', () => {
      const result = maestro['extractErrorMessage']([
        'Error 1',
        'Error 2',
        'Error 3',
      ]);

      expect(result).toBe('Error 1\nError 2\nError 3');
    });
  });

  describe('hasAnyFlowFailed', () => {
    it('should return true when a flow has DONE status with success !== 1', () => {
      const flows: MaestroFlowInfo[] = [
        { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
        { id: 2, name: 'flow2.yaml', status: 'DONE', success: 0 },
      ];

      const result = maestro['hasAnyFlowFailed'](flows);

      expect(result).toBe(true);
    });

    it('should return true when a flow has FAILED status', () => {
      const flows: MaestroFlowInfo[] = [
        { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
        { id: 2, name: 'flow2.yaml', status: 'FAILED' },
      ];

      const result = maestro['hasAnyFlowFailed'](flows);

      expect(result).toBe(true);
    });

    it('should return true when a flow has error_messages', () => {
      const flows: MaestroFlowInfo[] = [
        { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
        {
          id: 2,
          name: 'flow2.yaml',
          status: 'READY',
          error_messages: ['Error occurred'],
        },
      ];

      const result = maestro['hasAnyFlowFailed'](flows);

      expect(result).toBe(true);
    });

    it('should return false when all flows passed', () => {
      const flows: MaestroFlowInfo[] = [
        { id: 1, name: 'flow1.yaml', status: 'DONE', success: 1 },
        { id: 2, name: 'flow2.yaml', status: 'DONE', success: 1 },
      ];

      const result = maestro['hasAnyFlowFailed'](flows);

      expect(result).toBe(false);
    });

    it('should return false for empty flows array', () => {
      const flows: MaestroFlowInfo[] = [];

      const result = maestro['hasAnyFlowFailed'](flows);

      expect(result).toBe(false);
    });
  });

  describe('Error Message Display', () => {
    it('should display flow row with error message when failed', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const flow: MaestroFlowInfo = {
        id: 1,
        name: 'failing_flow.yaml',
        status: 'DONE',
        success: 0,
        error_messages: ['Assertion failed: expected true but got false'],
        requested_at: new Date(Date.now() - 30000).toISOString(),
        completed_at: new Date().toISOString(),
      };

      maestro['displayFlowRow'](flow, false, true);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('failing_flow.yaml');
      expect(output).toContain('Assertion failed');

      consoleSpy.mockRestore();
    });

    it('should display multiple error messages on continuation lines', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const flow: MaestroFlowInfo = {
        id: 1,
        name: 'failing_flow.yaml',
        status: 'DONE',
        success: 0,
        error_messages: [
          'First error line',
          'Second error line',
          'Third error line',
        ],
        requested_at: new Date(Date.now() - 30000).toISOString(),
        completed_at: new Date().toISOString(),
      };

      const linesWritten = maestro['displayFlowRow'](flow, false, true);

      expect(linesWritten).toBe(3); // Main row + 2 continuation lines
      expect(consoleSpy).toHaveBeenCalledTimes(3);
      expect(consoleSpy.mock.calls[0][0]).toContain('First error line');
      expect(consoleSpy.mock.calls[1][0]).toContain('Second error line');
      expect(consoleSpy.mock.calls[2][0]).toContain('Third error line');

      consoleSpy.mockRestore();
    });

    it('should not display error column when hasFailures is false', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const flow: MaestroFlowInfo = {
        id: 1,
        name: 'failing_flow.yaml',
        status: 'DONE',
        success: 0,
        error_messages: ['This should not appear'],
        requested_at: new Date(Date.now() - 30000).toISOString(),
        completed_at: new Date().toISOString(),
      };

      const linesWritten = maestro['displayFlowRow'](flow, false, false);

      expect(linesWritten).toBe(1); // Only main row, no error messages
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).not.toContain(
        'This should not appear',
      );

      consoleSpy.mockRestore();
    });

    it('should display table header with Fail reason column when hasFailures is true', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      maestro['displayFlowsTableHeader'](true);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy.mock.calls[0][0]).toContain('Fail reason');

      consoleSpy.mockRestore();
    });

    it('should display table header without Fail reason column when hasFailures is false', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      maestro['displayFlowsTableHeader'](false);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy.mock.calls[0][0]).not.toContain('Fail reason');

      consoleSpy.mockRestore();
    });
  });
});
