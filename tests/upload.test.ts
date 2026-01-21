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
    checkForUpdate: jest.fn(),
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

  // Helper to create a mock file handle for zip validation
  const createMockFileHandle = (magicBytes: number[]) => ({
    read: jest.fn().mockImplementation((buffer: Buffer) => {
      // Write the magic bytes to the provided buffer
      const srcBuffer = Buffer.from(magicBytes);
      srcBuffer.copy(buffer, 0, 0, Math.min(4, magicBytes.length));
      return Promise.resolve({
        bytesRead: Math.min(4, magicBytes.length),
        buffer,
      });
    }),
    close: jest.fn().mockResolvedValue(undefined),
  });

  // Valid ZIP magic bytes (PK\x03\x04)
  const ZIP_MAGIC_BYTES = [0x50, 0x4b, 0x03, 0x04];

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
    jest
      .spyOn(fs, 'createReadStream')
      .mockReturnValue(mockStream as fs.ReadStream);

    // Default mock for fs.promises.open - returns valid zip magic bytes
    // Tests that need different behavior should override this
    jest
      .spyOn(fs.promises, 'open')
      .mockResolvedValue(
        createMockFileHandle(ZIP_MAGIC_BYTES) as unknown as fs.promises.FileHandle,
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful uploads', () => {
    it('should upload a file and return the id', async () => {
      const mockResponse = { data: { id: 12345 }, headers: {} };
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
      const mockResponse = { data: { id: 67890 }, headers: {} };
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
      const mockResponse = { data: { id: 11111 }, headers: {} };
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

    it('should validate zip format when validateZipFormat is true', async () => {
      // Override with invalid magic bytes (not a zip file)
      const invalidFileHandle = createMockFileHandle([0x00, 0x00, 0x00, 0x00]);
      jest
        .spyOn(fs.promises, 'open')
        .mockResolvedValue(invalidFileHandle as unknown as fs.promises.FileHandle);

      const options = createUploadOptions({
        filePath: '/path/to/invalid.apk',
        validateZipFormat: true,
      });

      await expect(upload.upload(options)).rejects.toThrow(
        /Invalid file format.*not a valid.*archive/,
      );
      expect(invalidFileHandle.close).toHaveBeenCalled();
    });

    it('should accept valid zip files when validateZipFormat is true', async () => {
      // Default mock already returns valid ZIP magic bytes
      const mockResponse = { data: { id: 12345 }, headers: {} };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions({
        validateZipFormat: true,
      });

      const result = await upload.upload(options);
      expect(result).toEqual({ id: 12345 });
    });

    it('should skip zip validation when validateZipFormat is not set', async () => {
      const mockResponse = { data: { id: 12345 }, headers: {} };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      // Clear the default open mock and set up a fresh spy
      jest.restoreAllMocks();
      jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({
        size: 1024 * 1024,
      } as fs.Stats);
      const mockStream = new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          this.push(null);
        },
      });
      jest
        .spyOn(fs, 'createReadStream')
        .mockReturnValue(mockStream as fs.ReadStream);
      const openSpy = jest.spyOn(fs.promises, 'open');

      const options = createUploadOptions();
      // validateZipFormat is not set, so it defaults to undefined (falsy)

      const result = await upload.upload(options);
      expect(result).toEqual({ id: 12345 });
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('API error handling', () => {
    it('should throw an error if API returns no id', async () => {
      const mockResponse = {
        data: { error: 'Invalid file format' },
        headers: {},
      };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        new TestingBotError('Upload failed: Invalid file format'),
      );
    });

    it('should throw an error with unknown error when no error message provided', async () => {
      const mockResponse = { data: {}, headers: {} };
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
        /Network request failed|Network Error/,
      );
    });

    it('should handle 400 bad request with server error message', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 400,
          data: {
            error: 'Invalid file format: expected APK but got ZIP',
          },
        },
      };
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        /Upload rejected:.*Invalid file format/,
      );
    });

    it('should handle 400 bad request with message field', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 400,
          data: {
            message: 'The uploaded file is corrupted',
          },
        },
      };
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        /Upload rejected:.*corrupted/,
      );
    });

    it('should handle 400 bad request with no error message', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 400,
          data: {},
        },
      };
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        /Upload rejected:.*not accepted/,
      );
    });

    it('should handle 500 server errors via handleAxiosError', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 500,
          data: {
            error: 'Internal server error',
          },
        },
      };
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(/Server error/);
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Something went wrong');
      (axios.post as jest.Mock).mockRejectedValueOnce(genericError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(false);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        /Upload failed:.*Something went wrong/,
      );
    });

    it('should handle 401 unauthorized errors', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 401',
        response: {
          status: 401,
          data: {},
        },
      };
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        /Invalid TestingBot credentials/,
      );
    });

    it('should handle 429 credits depleted errors', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 429',
        response: {
          status: 429,
          data: {},
        },
      };
      (axios.post as jest.Mock).mockRejectedValueOnce(axiosError);
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      const options = createUploadOptions();

      await expect(upload.upload(options)).rejects.toThrow(
        /Rate limit exceeded|credits/i,
      );
    });
  });

  describe('progress tracking', () => {
    it('should show progress bar when showProgress is true', async () => {
      const mockResponse = { data: { id: 12345 }, headers: {} };
      (axios.post as jest.Mock).mockResolvedValueOnce(mockResponse);

      // Mock process.stdout.write to capture progress output
      const writeSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const options = createUploadOptions({ showProgress: true });
      await upload.upload(options);

      // Should show progress bar with filename
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('app.apk'));
      // Should show percentage in progress bar
      expect(writeSpy).toHaveBeenCalledWith(expect.stringMatching(/\d+%/));
      // Should print newline when complete
      expect(logSpy).toHaveBeenCalledWith('');

      writeSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('should not show upload message when showProgress is false', async () => {
      const mockResponse = { data: { id: 12345 }, headers: {} };
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
