import Auth from '../src/auth';
import Credentials from '../src/models/credentials';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('node:fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    readFile: jest.fn(),
  },
}));

describe('Auth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TB_KEY;
    delete process.env.TB_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getCredentials', () => {
    it('should use CLI options when provided (highest precedence)', async () => {
      // Set up env vars and file to prove CLI takes precedence
      process.env.TB_KEY = 'env-key';
      process.env.TB_SECRET = 'env-secret';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        'file-key:file-secret',
      );

      const credentials = await Auth.getCredentials({
        apiKey: 'cli-key',
        apiSecret: 'cli-secret',
      });

      expect(credentials).toBeInstanceOf(Credentials);
      expect(credentials?.userName).toBe('cli-key');
      expect(credentials?.accessKey).toBe('cli-secret');
    });

    it('should use environment variables when CLI options not provided', async () => {
      process.env.TB_KEY = 'env-key';
      process.env.TB_SECRET = 'env-secret';
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        'file-key:file-secret',
      );

      const credentials = await Auth.getCredentials();

      expect(credentials).toBeInstanceOf(Credentials);
      expect(credentials?.userName).toBe('env-key');
      expect(credentials?.accessKey).toBe('env-secret');
    });

    it('should use environment variables when only apiKey is provided via CLI', async () => {
      process.env.TB_KEY = 'env-key';
      process.env.TB_SECRET = 'env-secret';

      const credentials = await Auth.getCredentials({
        apiKey: 'cli-key',
        // apiSecret not provided
      });

      expect(credentials).toBeInstanceOf(Credentials);
      expect(credentials?.userName).toBe('env-key');
      expect(credentials?.accessKey).toBe('env-secret');
    });

    it('should fall back to ~/.testingbot file when no env vars', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        'file-key:file-secret',
      );

      const credentials = await Auth.getCredentials();

      expect(credentials).toBeInstanceOf(Credentials);
      expect(credentials?.userName).toBe('file-key');
      expect(credentials?.accessKey).toBe('file-secret');
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        path.join(os.homedir(), '.testingbot'),
      );
    });

    it('should handle ~/.testingbot file with trailing newline', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(
        'file-key:file-secret\n',
      );

      const credentials = await Auth.getCredentials();

      expect(credentials).toBeInstanceOf(Credentials);
      expect(credentials?.userName).toBe('file-key');
      expect(credentials?.accessKey).toBe('file-secret');
    });

    it('should return null when no credentials available', async () => {
      (fs.promises.readFile as jest.Mock).mockRejectedValue(
        new Error('ENOENT'),
      );

      const credentials = await Auth.getCredentials();

      expect(credentials).toBeNull();
    });

    it('should return null when ~/.testingbot file is empty', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('');

      const credentials = await Auth.getCredentials();

      expect(credentials).toBeNull();
    });

    it('should return null when ~/.testingbot file has invalid format', async () => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue('invalid-no-colon');

      const credentials = await Auth.getCredentials();

      expect(credentials).toBeNull();
    });
  });
});
