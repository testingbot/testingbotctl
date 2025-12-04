import Maestro from '../../src/providers/maestro';
import MaestroOptions from '../../src/models/maestro_options';
import TestingBotError from '../../src/models/testingbot_error';
import fs from 'node:fs';
import axios from 'axios';
import { Readable } from 'node:stream';
import Credentials from '../../src/models/credentials';
import * as fileTypeDetector from '../../src/utils/file-type-detector';

jest.mock('axios');
jest.mock('../../src/utils/file-type-detector');
jest.mock('../../src/utils', () => ({
  __esModule: true,
  default: {
    getUserAgent: jest.fn().mockReturnValue('TestingBot-CTL-test'),
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
      const mockFileStream = new Readable();
      mockFileStream._read = jest.fn();

      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      fs.createReadStream = jest.fn().mockReturnValue(mockFileStream);

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
      const mockFileStream = new Readable();
      mockFileStream._read = jest.fn();

      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      fs.createReadStream = jest.fn().mockReturnValue(mockFileStream);

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
});
