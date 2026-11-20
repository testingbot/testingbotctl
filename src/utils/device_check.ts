import Credentials from '../models/credentials';
import TestingBotError from '../models/testingbot_error';
import {
  CatalogDevice,
  DeviceFramework,
  listDevices,
} from '../providers/account';
import utils from '../utils';
import { readState, writeState } from './state';

/**
 * Checks --device / --device-matrix names against the device catalog before
 * anything is uploaded, so a typo fails in a second with a suggestion instead
 * of after a long upload. Deliberately lenient, because the server also
 * accepts patterns and partial names:
 *
 * - wildcard and regex names ("Pixel.*", "*") are not checked;
 * - a name counts as found when any catalog device contains it;
 * - when the catalog cannot be fetched, nothing is checked.
 *
 * TESTINGBOT_SKIP_DEVICE_CHECK=1 turns it off.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedCatalog {
  fetchedAt: number;
  devices: CatalogDevice[];
}

function cacheName(framework: DeviceFramework, real: boolean): string {
  return `devices-${framework}-${real ? 'real' : 'virtual'}.json`;
}

/** The cached catalog, regardless of age (for shell completion). */
export function cachedDevices(
  framework: DeviceFramework,
  real = false,
): CatalogDevice[] | undefined {
  return readState<CachedCatalog>(cacheName(framework, real))?.devices;
}

export function cacheDevices(
  framework: DeviceFramework,
  real: boolean,
  devices: CatalogDevice[],
): void {
  writeState(cacheName(framework, real), { fetchedAt: Date.now(), devices });
}

/** The catalog from a fresh cache, else from the API (and cached). */
export async function loadDeviceCatalog(
  framework: DeviceFramework,
  real: boolean,
  credentials?: Credentials,
  now: number = Date.now(),
): Promise<CatalogDevice[]> {
  const cached = readState<CachedCatalog>(cacheName(framework, real));
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.devices;
  const devices = await listDevices({ framework, real, credentials });
  if (Array.isArray(devices)) cacheDevices(framework, real, devices);
  return devices;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

/** Levenshtein distance, for "did you mean". */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Catalog names closest to `name`, best first. */
export function suggestDevices(
  name: string,
  devices: CatalogDevice[],
  limit = 3,
): string[] {
  const target = normalize(name);
  const compact = (s: string) => s.replace(/ /g, '');
  const scored = [...new Set(devices.map((d) => d.name))].map((candidate) => {
    const c = normalize(candidate);
    const distance = Math.min(
      editDistance(target, c),
      // "Pixel9" vs "Pixel 9", "iphone16" vs "iPhone 16"
      editDistance(compact(target), compact(c)),
    );
    return { candidate, distance };
  });
  const maxDistance = Math.max(2, Math.ceil(target.length / 3));
  const close = scored.filter((s) => s.distance <= maxDistance);
  // Only the best matches: "Pixle 9" means Pixel 9, not also Pixel 8.
  const best = Math.min(...close.map((s) => s.distance));
  return close
    .filter((s) => s.distance === best)
    .sort((a, b) => a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((s) => s.candidate);
}

/**
 * True when the name is a wildcard or regex ("iPhone (8|11)", ".*Pixel.*",
 * "Galaxy S2[34]"): the API matches those itself, so they are not checked.
 */
export function isDevicePattern(device: string): boolean {
  return utils.isWildcardDevice(device) || /[|()[\]^$+\\{}]/.test(device);
}

/** "18", "18.2", "18.2.0": a literal version the catalog can confirm. */
const LITERAL_VERSION = /^\d+(\.\d+)*$/;

/** Drops trailing ".0" parts so "18.0.0", "18.0" and "18" compare equal. */
function trimVersion(v: string): string {
  return v.replace(/(\.0+)+$/, '');
}

export interface DeviceRequest {
  device?: string;
  version?: string;
  real?: boolean;
}

/** A problem with one requested device, or undefined when it looks fine. */
export function checkDevice(
  request: DeviceRequest,
  devices: CatalogDevice[],
): string | undefined {
  const { device, version } = request;
  if (!device || isDevicePattern(device) || devices.length === 0) {
    return undefined;
  }
  const target = normalize(device);
  const contains = devices.filter((d) => normalize(d.name).includes(target));
  if (contains.length === 0) {
    const suggestions = suggestDevices(device, devices);
    const hint =
      suggestions.length > 0
        ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?`
        : '';
    return `No ${request.real ? 'real ' : ''}device named "${device}".${hint}`;
  }
  // Only check the version against an exact name: a partial name may cover
  // several devices with different versions.
  const exact = contains.filter((d) => normalize(d.name) === target);
  if (
    version &&
    exact.length > 0 &&
    // Ranges (">= 18"), "latest" and patterns are left to the API.
    LITERAL_VERSION.test(version.trim()) &&
    exact.every((d) => d.versions.length > 0)
  ) {
    const versions = [...new Set(exact.flatMap((d) => d.versions))];
    const wanted = trimVersion(version.trim());
    const ok = versions.some((raw) => {
      const v = trimVersion(raw);
      return v === wanted || v.startsWith(`${wanted}.`);
    });
    if (!ok) {
      return `"${exact[0].name}" has no OS version ${version}. Available: ${versions.join(', ')}.`;
    }
  }
  return undefined;
}

/**
 * Throws a TestingBotError listing every requested device that does not
 * exist. Never throws for an unreachable catalog.
 */
export async function verifyDevices(
  framework: DeviceFramework,
  requests: DeviceRequest[],
  credentials?: Credentials,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.TESTINGBOT_SKIP_DEVICE_CHECK) return;
  const checked = requests.filter(
    (r) => r.device && !isDevicePattern(r.device),
  );
  if (checked.length === 0) return;

  const problems: string[] = [];
  for (const real of [false, true]) {
    const group = checked.filter((r) => Boolean(r.real) === real);
    if (group.length === 0) continue;
    let devices: CatalogDevice[];
    try {
      devices = await loadDeviceCatalog(framework, real, credentials);
    } catch {
      continue; // Let the API decide.
    }
    if (!Array.isArray(devices)) continue;
    for (const request of group) {
      const problem = checkDevice(request, devices);
      if (problem) problems.push(problem);
    }
  }
  if (problems.length === 0) return;
  throw new TestingBotError(
    [
      ...problems,
      `See every device with "testingbot devices --framework ${framework}${checked.some((r) => r.real) ? ' --real' : ''}".`,
      'Set TESTINGBOT_SKIP_DEVICE_CHECK=1 to skip this check.',
    ].join('\n'),
  );
}
