import axios, { AxiosError } from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Credentials from '../models/credentials';
import TestingBotError from '../models/testingbot_error';
import utils from '../utils';
import { HTTP } from '../config/constants';
import { handleAxiosError } from '../utils/error-helpers';

const API_URL = 'https://api.testingbot.com/v1';

export const CREDENTIALS_FILE = path.join(os.homedir(), '.testingbot');

export type DeviceFramework = 'maestro' | 'espresso' | 'xcuitest';
export type DevicePlatform = 'Android' | 'iOS';

export interface AccountInfo {
  id: number;
  name: string;
  plan?: string;
  /** Remaining test minutes (the API reports seconds). */
  minutesLeft?: number;
  concurrency: {
    virtual?: number;
    physical?: number;
    runningVirtual?: number;
    runningPhysical?: number;
  };
}

export interface CatalogDevice {
  name: string;
  platform: DevicePlatform;
  /** Newest first. */
  versions: string[];
  type?: string;
  real: boolean;
  /** Real devices only: at least one unit is free right now. */
  available?: boolean;
}

interface UserResponse {
  id: number;
  first_name?: string;
  last_name?: string;
  plan?: string;
  seconds?: number;
  max_concurrent?: number;
  max_concurrent_mobile?: number;
  current_vm_concurrency?: number;
  current_physical_concurrency?: number;
}

interface BrowserResponse {
  deviceName?: string;
  platformName?: string;
  version?: string;
  device_type?: string;
}

interface RealDeviceResponse {
  name?: string;
  platform_name?: string;
  version?: string;
  available?: boolean;
}

function request(credentials?: Credentials) {
  return {
    headers: { 'User-Agent': utils.getUserAgent() },
    timeout: HTTP.TIMEOUT_MS,
    ...(credentials && {
      auth: {
        username: credentials.userName,
        password: credentials.accessKey,
      },
    }),
  };
}

async function get<T>(
  url: string,
  operation: string,
  credentials?: Credentials,
): Promise<T> {
  try {
    const response = await axios.get<T>(url, request(credentials));
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw handleAxiosError(error as AxiosError, operation);
    }
    throw error;
  }
}

export async function fetchAccount(
  credentials: Credentials,
): Promise<AccountInfo> {
  const user = await get<UserResponse>(
    `${API_URL}/user`,
    'Fetching account',
    credentials,
  );
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return {
    id: user.id,
    name,
    plan: user.plan,
    minutesLeft:
      typeof user.seconds === 'number'
        ? Math.floor(user.seconds / 60)
        : undefined,
    concurrency: {
      virtual: user.max_concurrent,
      physical: user.max_concurrent_mobile,
      runningVirtual: user.current_vm_concurrency,
      runningPhysical: user.current_physical_concurrency,
    },
  };
}

/**
 * Removes ~/.testingbot. Returns false when there was nothing to remove.
 */
export async function removeSavedCredentials(): Promise<boolean> {
  try {
    await fs.promises.unlink(CREDENTIALS_FILE);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Platforms a framework runs on; Maestro runs on both. */
function frameworkPlatforms(framework: DeviceFramework): DevicePlatform[] {
  if (framework === 'espresso') return ['Android'];
  if (framework === 'xcuitest') return ['iOS'];
  return ['Android', 'iOS'];
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
  }
  return b.localeCompare(a);
}

function normalizePlatform(value: string | undefined): DevicePlatform | null {
  const lower = value?.toLowerCase();
  if (lower === 'android') return 'Android';
  if (lower === 'ios') return 'iOS';
  return null;
}

/**
 * Devices a framework can run on, one entry per device name and platform
 * with every OS version. Emulators and simulators come from the public
 * catalog; real devices need credentials and carry live availability.
 */
export async function listDevices(options: {
  framework: DeviceFramework;
  real?: boolean;
  platform?: DevicePlatform;
  credentials?: Credentials;
}): Promise<CatalogDevice[]> {
  const platforms = frameworkPlatforms(options.framework).filter(
    (p) => !options.platform || p === options.platform,
  );
  const grouped = new Map<string, CatalogDevice>();
  const add = (
    name: string | undefined,
    platform: DevicePlatform | null,
    version: string | undefined,
    extra: Partial<CatalogDevice>,
  ) => {
    if (!name || !platform || !platforms.includes(platform)) return;
    const key = `${platform}\u0000${name}`;
    let device = grouped.get(key);
    if (!device) {
      device = { name, platform, versions: [], real: Boolean(options.real) };
      grouped.set(key, device);
    }
    if (version && !device.versions.includes(version)) {
      device.versions.push(version);
    }
    if (extra.type && !device.type) device.type = extra.type;
    if (extra.available !== undefined) {
      device.available = Boolean(device.available) || extra.available;
    }
  };

  if (options.real) {
    if (!options.credentials) {
      throw new TestingBotError('Listing real devices requires credentials.');
    }
    const devices = await get<RealDeviceResponse[]>(
      `${API_URL}/devices`,
      'Listing real devices',
      options.credentials,
    );
    for (const d of devices) {
      add(d.name, normalizePlatform(d.platform_name), d.version, {
        available: Boolean(d.available),
      });
    }
  } else {
    const environments = await get<BrowserResponse[]>(
      `${API_URL}/browsers/${options.framework}`,
      'Listing devices',
    );
    for (const e of environments) {
      add(e.deviceName, normalizePlatform(e.platformName), e.version, {
        type: e.device_type,
      });
    }
  }

  const devices = [...grouped.values()];
  for (const device of devices) device.versions.sort(compareVersionsDesc);
  return devices.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name),
  );
}
