import Upload, { UploadOptions, ContentType } from '../src/upload';
import Credentials from '../src/models/credentials';
import TestingBotError from '../src/models/testingbot_error';
import axios, { AxiosError } from 'axios';
import fs from 'node:fs';
import { Readable } from 'node:stream';

jest.mock('axios');
jest.mock('../src/utils', () => ({
  __esModule: true,
  default: {
    getUserAgent: jest.fn().mockReturnValue('TestingBot-CTL-test'),
  },
}));

describe('Upload', () => {
  let upload: Upload;
  const mockCredentials = new Credentials('testUser', 'testKey');

  const createUploadOptions = (
    overrides: Partial<UploadOptions> = {},
  ): UploadOptions => ({
    filePath: '/path/to/app.apk',
    url: 'https://api.testingbot.com/v1/app-automate/espresso/app',
    credentials: mockCredentials,
    contentType: 'application/vnd.android.package-archive' as ContentType,
    showProgress: false,
    ...overrides,
  });

  beforeEach(() => {
    upload = new Upload();
    jest.clearAllMocks();

    // Mock fs.promises.access to succeed by default
    jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);

    // Mock fs.promises.stat to return file size
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: 1024 * 1024, // 1 MB
    } as fs.Stats);

    // Mock fs.createReadStream
    const mockStream = new Readable();
    mockStream._read = jest.fn();
    jest
      .spyOn(fs, 'createReadStream')
      .mockReturnValue(mockStream as fs.ReadStream);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful uploads', () => {
    it('should upload a file and return the id', async () => {
      const mockResponse = { data: { id: 12345 } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions();
      const result = await upload.upload(options);

      expect(result).toEqual({ id: 12345 });
      expect(axios.post).toHaveBeenCalledWith(
        options.url,
        expect.any(Object), // FormData
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': 'attachment; filename=app.apk',
            'User-Agent': 'TestingBot-CTL-test',
          }),
          auth: {
            username: 'testUser',
            password: 'testKey',
          },
        }),
      );
    });

    it('should use the correct content type for iOS apps', async () => {
      const mockResponse = { data: { id: 67890 } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions({
        filePath: '/path/to/app.ipa',
        contentType: 'application/octet-stream',
      });
      const result = await upload.upload(options);

      expect(result).toEqual({ id: 67890 });
      expect(axios.post).toHaveBeenCalledWith(
        options.url,
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/octet-stream',
          }),
        }),
      );
    });

    it('should use the correct content type for zip files', async () => {
      const mockResponse = { data: { id: 11111 } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions({
        filePath: '/path/to/tests.zip',
        contentType: 'application/zip',
      });
      const result = await upload.upload(options);

      expect(result).toEqual({ id: 11111 });
      expect(axios.post).toHaveBeenCalledWith(
        options.url,
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/zip',
          }),
        }),
      );
    });
  });

  describe('file validation', () => {
    it('should throw an error if file does not exist', async () => {
      jest
        .spyOn(fs.promises, 'access')
        .mockRejectedValueOnce(new Error('ENOENT'));

      const options = createUploadOptions({
        filePath: '/path/to/nonexistent.apk',
      });

      await expect(upload.upload(options)).rejects.toThrow(
        new TestingBotError(
          'File not found or not readable: /path/to/nonexistent.apk',
        ),
      );
    });

    it('should throw an error if file is not readable', async () => {
      jest
        .spyOn(fs.promises, 'access')
        .mockRejectedValueOnce(new Error('EACCES'));

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(TestingBotError);
    });
  });

  describe('API error handling', () => {
    it('should throw an error if API returns no id', async () => {
      const mockResponse = { data: { error: 'Invalid file format' } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        new TestingBotError('Upload failed: Invalid file format'),
      );
    });

    it('should throw an error with unknown error when no error message provided', async () => {
      const mockResponse = { data: {} };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        new TestingBotError('Upload failed: Unknown error'),
      );
    });

    it('should handle axios network errors', async () => {
      const axiosError = new Error('Network Error') as AxiosError;
      axiosError.isAxiosError = true;
      axiosError.message = 'Network Error';
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        new TestingBotError('Upload failed: Network Error'),
      );
    });

    it('should handle axios errors with response data', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          data: {
            error: 'Unauthorized',
          },
        },
      };
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        new TestingBotError('Upload failed: Unauthorized'),
      );
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Something went wrong');
      (axios.post as jest.Mock).mockRejectedValueOnce(genericError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(false);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        new TestingBotError('Upload failed: Something went wrong'),
      );
    });
  });

  describe('progress tracking', () => {
    it('should configure onUploadProgress when showProgress is true', async () => {
      const mockResponse = { data: { id: 12345 } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      // Mock process.stdout.write to prevent console output during tests
      const writeSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      const options = createUploadOptions({ showProgress: true });
      await upload.upload(options);

      expect(axios.post).toHaveBeenCalledWith(
        options.url,
        expect.any(Object),
        expect.objectContaining({
          onUploadProgress: expect.any(Function),
        }),
      );

      writeSpy.mockRestore();
    });

    it('should not configure onUploadProgress when showProgress is false', async () => {
      const mockResponse = { data: { id: 12345 } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions({ showProgress: false });
      await upload.upload(options);

      expect(axios.post).toHaveBeenCalledWith(
        options.url,
        expect.any(Object),
        expect.objectContaining({
          onUploadProgress: undefined,
        }),
      );
    });
  });
});
