import XCUITest from '../../src/providers/xcuitest';
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
jest.mock('node:fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    access: jest.fn(),
    stat: jest.fn(),
  },
}));

describe('Espresso', () => {
  let xcuiTest: XCUITest;
  const mockCredentials = new Credentials('testUser', 'testKey');

  const mockOptions: XCUITestOptions = new XCUITestOptions(
    'path/to/app.apk',
    'path/to/testApp.zip',
    'Test Device',
  );

  beforeEach(() => {
    xcuiTest = new XCUITest(mockCredentials, mockOptions);
  });

  describe('Validation', () => {
    it('should pass validation when app, testApp, and device are provided', async () => {
      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(xcuiTest['validate']()).resolves.toBe(true);
    });
  });

  describe('Upload App', () => {
    it('should successfully upload an app and set appId', async () => {
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

      await expect(xcuiTest['uploadApp']()).resolves.toBe(true);
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

      await expect(xcuiTest['uploadApp']()).rejects.toThrow(
        new TestingBotError('Upload failed: Upload failed'),
      );
    });
  });

  describe('Upload Test App', () => {
    it('should successfully upload the test app', async () => {
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

      await expect(xcuiTest['uploadTestApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.testApp);
    });

    it('should throw an error if test app upload fails', async () => {
      const mockFileStream = new Readable();
      mockFileStream._read = jest.fn();

      fs.promises.access = jest.fn().mockResolvedValue(undefined);
      fs.promises.stat = jest.fn().mockResolvedValue({ size: 1024 });
      fs.createReadStream = jest.fn().mockReturnValue(mockFileStream);

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

    it('should throw an error if running tests fails', async () => {
      const mockError = new Error('Test failed');
      axios.post = jest.fn().mockRejectedValueOnce(mockError);

      await expect(xcuiTest['runTests']()).rejects.toThrow(
        new TestingBotError('Running XCUITest failed', { cause: mockError }),
      );
    });
  });
});
