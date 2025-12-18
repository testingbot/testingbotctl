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

    // Mock fs.createReadStream with a Readable-like object that FormData accepts
    const mockStream = new Readable({
      read() {
        this.push(Buffer.alloc(1024));
        this.push(null);
      },
    });
    jest.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as fs.ReadStream);
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
            'User-Agent': 'TestingBot-CTL-test',
          }),
          auth: {
            username: 'testUser',
            password: 'testKey',
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }),
      );
      // Verify multipart/form-data content type is set by FormData
      const callArgs = (axios.post as jest.Mock).mock.calls[0][2];
      expect(callArgs.headers['content-type']).toMatch(/^multipart\/form-data/);
    });

    it('should upload iOS apps successfully', async () => {
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
          auth: {
            username: 'testUser',
            password: 'testKey',
          },
        }),
      );
    });

    it('should upload zip files successfully', async () => {
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
          auth: {
            username: 'testUser',
            password: 'testKey',
          },
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
    it('should show progress bar when showProgress is true', async () => {
      const mockResponse = { data: { id: 12345 } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      // Mock process.stdout.write to capture progress output
      const writeSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const options = createUploadOptions({ showProgress: true });
      await upload.upload(options);

      // Should show progress bar with filename
      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining('app.apk'),
      );
      // Should show percentage in progress bar
      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\d+%/),
      );
      // Should print newline when complete
      expect(logSpy).toHaveBeenCalledWith('');

      writeSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should not show upload message when showProgress is false', async () => {
      const mockResponse = { data: { id: 12345 } };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const writeSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      const options = createUploadOptions({ showProgress: false });
      await upload.upload(options);

      // Should not show any upload message
      expect(writeSpy).not.toHaveBeenCalled();

      writeSpy.mockRestore();
    });
  });
});
