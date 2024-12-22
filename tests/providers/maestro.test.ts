import Maestro from '../../src/providers/maestro';
import MaestroOptions from '../../src/models/maestro_options';
import TestingBotError from '../../src/models/testingbot_error';
import fs from 'node:fs';
import axios from 'axios';
import { Readable } from 'node:stream';
import Credentials from '../../src/models/credentials';

jest.mock('axios');
jest.mock('../../src/utils');
jest.mock('node:fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    access: jest.fn(),
  },
}));

describe('Maestro', () => {
  let maestro: Maestro;
  const mockCredentials = new Credentials('testUser', 'testKey');

  const mockOptions: MaestroOptions = new MaestroOptions(
    'path/to/app.apk',
    'path/to/testApp.zip',
    'Test Device',
    'Test Emulator',
  );

  beforeEach(() => {
    maestro = new Maestro(mockCredentials, mockOptions);
  });

  describe('Validation', () => {
    it('should pass validation when app, testApp, and device are provided', async () => {
      fs.promises.access = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await expect(maestro['validate']()).resolves.toBe(true);
    });
  });

  describe('Upload App', () => {
    it('should successfully upload an app and set appId', async () => {
      const mockFileStream = new Readable();
      mockFileStream._read = jest.fn();

      fs.createReadStream = jest.fn().mockReturnValue(mockFileStream);

      const mockResponse = {
        data: {
          id: '1234',
        },
      };

      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(maestro['uploadApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.app);
    });

    it('should throw an error if app upload fails', async () => {
      const mockResponse = { data: { error: 'Upload failed' } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(maestro['uploadApp']()).rejects.toThrow(
        new TestingBotError('Uploading app failed: Upload failed'),
      );
    });
  });

  describe('Upload Test App', () => {
    it('should successfully upload the test app', async () => {
      const mockFileStream = new Readable();
      mockFileStream._read = jest.fn();

      fs.createReadStream = jest.fn().mockReturnValue(mockFileStream);

      const mockResponse = {
        data: {
          id: '1234',
        },
      };

      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(maestro['uploadTestApp']()).resolves.toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledWith(mockOptions.testApp);
    });

    it('should throw an error if test app upload fails', async () => {
      const mockResponse = { data: { error: 'Test app upload failed' } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(maestro['uploadTestApp']()).rejects.toThrow(
        new TestingBotError(
          'Uploading test app failed: Test app upload failed',
        ),
      );
    });
  });

  describe('Run Tests', () => {
    it('should successfully run the tests', async () => {
      const mockResponse = { data: { success: true } };
      axios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      await expect(maestro['runTests']()).resolves.toBe(true);
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
  });
});
