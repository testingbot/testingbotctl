import axios from 'axios';
import fs from 'node:fs';
import Credentials from '../../src/models/credentials';
import {
  CREDENTIALS_FILE,
  fetchAccount,
  listDevices,
  removeSavedCredentials,
} from '../../src/providers/account';

jest.mock('axios');
jest.mock('node:fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    unlink: jest.fn(),
  },
}));

const credentials = new Credentials('key', 'secret');
const mockGet = axios.get as jest.Mock;

describe('account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios.isAxiosError as unknown as jest.Mock) = jest
      .fn()
      .mockReturnValue(false);
  });

  describe('fetchAccount', () => {
    it('maps /v1/user to name, plan, minutes and concurrency', async () => {
      mockGet.mockResolvedValue({
        data: {
          id: 7,
          first_name: 'Ada',
          last_name: 'Lovelace',
          plan: 'Pro',
          seconds: 3725,
          max_concurrent: 5,
          max_concurrent_mobile: 2,
          current_vm_concurrency: 1,
          current_physical_concurrency: 0,
        },
      });

      const account = await fetchAccount(credentials);

      expect(mockGet).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/user',
        expect.objectContaining({
          auth: { username: 'key', password: 'secret' },
        }),
      );
      expect(account).toEqual({
        id: 7,
        name: 'Ada Lovelace',
        plan: 'Pro',
        minutesLeft: 62,
        concurrency: {
          virtual: 5,
          physical: 2,
          runningVirtual: 1,
          runningPhysical: 0,
        },
      });
    });
  });

  describe('listDevices', () => {
    it('groups the public catalog by device, newest version first, without auth', async () => {
      mockGet.mockResolvedValue({
        data: [
          {
            deviceName: 'Pixel 9',
            platformName: 'Android',
            version: '14.0',
            device_type: 'phone',
          },
          {
            deviceName: 'Pixel 9',
            platformName: 'Android',
            version: '16.0',
            device_type: 'phone',
          },
          {
            deviceName: 'iPhone 16',
            platformName: 'iOS',
            version: '18.2',
            device_type: 'phone',
          },
          { deviceName: 'Chrome', platformName: 'WINDOWS', version: '120' },
        ],
      });

      const devices = await listDevices({ framework: 'maestro' });

      const [url, config] = mockGet.mock.calls[0];
      expect(url).toBe('https://api.testingbot.com/v1/browsers/maestro');
      expect(config.auth).toBeUndefined();
      expect(devices).toEqual([
        {
          name: 'Pixel 9',
          platform: 'Android',
          versions: ['16.0', '14.0'],
          type: 'phone',
          real: false,
        },
        {
          name: 'iPhone 16',
          platform: 'iOS',
          versions: ['18.2'],
          type: 'phone',
          real: false,
        },
      ]);
    });

    it('keeps only the platforms the framework and --platform allow', async () => {
      mockGet.mockResolvedValue({
        data: [
          { deviceName: 'Pixel 9', platformName: 'Android', version: '16.0' },
          { deviceName: 'iPhone 16', platformName: 'iOS', version: '18.2' },
        ],
      });

      expect(
        (await listDevices({ framework: 'espresso' })).map((d) => d.name),
      ).toEqual(['Pixel 9']);
      expect(
        (await listDevices({ framework: 'maestro', platform: 'iOS' })).map(
          (d) => d.name,
        ),
      ).toEqual(['iPhone 16']);
    });

    it('lists real devices with auth and availability', async () => {
      mockGet.mockResolvedValue({
        data: [
          {
            name: 'Galaxy S24',
            platform_name: 'Android',
            version: '14.0',
            available: false,
          },
          {
            name: 'Galaxy S24',
            platform_name: 'Android',
            version: '14.0',
            available: true,
          },
          {
            name: 'Galaxy S8',
            platform_name: 'Android',
            version: '9.0',
            available: false,
          },
        ],
      });

      const devices = await listDevices({
        framework: 'maestro',
        real: true,
        credentials,
      });

      expect(mockGet).toHaveBeenCalledWith(
        'https://api.testingbot.com/v1/devices',
        expect.objectContaining({
          auth: { username: 'key', password: 'secret' },
        }),
      );
      expect(devices).toEqual([
        {
          name: 'Galaxy S24',
          platform: 'Android',
          versions: ['14.0'],
          real: true,
          available: true,
        },
        {
          name: 'Galaxy S8',
          platform: 'Android',
          versions: ['9.0'],
          real: true,
          available: false,
        },
      ]);
    });

    it('refuses real devices without credentials', async () => {
      await expect(
        listDevices({ framework: 'maestro', real: true }),
      ).rejects.toThrow('requires credentials');
    });
  });

  describe('removeSavedCredentials', () => {
    const mockUnlink = fs.promises.unlink as jest.Mock;

    it('removes ~/.testingbot', async () => {
      mockUnlink.mockResolvedValue(undefined);
      await expect(removeSavedCredentials()).resolves.toBe(true);
      expect(mockUnlink).toHaveBeenCalledWith(CREDENTIALS_FILE);
    });

    it('returns false when the file does not exist', async () => {
      mockUnlink.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );
      await expect(removeSavedCredentials()).resolves.toBe(false);
    });

    it('rethrows other errors', async () => {
      mockUnlink.mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' }),
      );
      await expect(removeSavedCredentials()).rejects.toThrow('EACCES');
    });
  });
});
