import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import TestingBotError from '../models/testingbot_error';
import utils from '../utils';

const execFileAsync = promisify(execFile);

/**
 * Where an app under test can come from besides a local .apk/.ipa/.app/.zip:
 * a download URL (EAS Build, an artifact store, a release page) and .tar.gz
 * archives, which is what EAS produces for iOS simulator builds. Both are
 * turned into a local path the rest of the upload pipeline already handles.
 */

export const APP_EXTENSIONS = [
  '.apk',
  '.apks',
  '.ipa',
  '.app',
  '.zip',
  '.tar.gz',
];

const URL_PATTERN = /^https?:\/\//i;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'application/vnd.android.package-archive': '.apk',
  'application/gzip': '.tar.gz',
  'application/x-gzip': '.tar.gz',
  'application/x-tar': '.tar.gz',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/octet-stream+ipa': '.ipa',
};

export function isAppUrl(value: string | undefined): boolean {
  return !!value && URL_PATTERN.test(value.trim());
}

/**
 * The app extension of a path, treating `.tar.gz` as one extension (Node's
 * path.extname would report `.gz`). Lowercase, including the dot.
 */
export function appExtension(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  return path.extname(lower);
}

export function isSupportedAppExtension(filePath: string): boolean {
  return APP_EXTENSIONS.includes(appExtension(filePath));
}

/** Filename hint from the URL path, ignoring the query string. */
function filenameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function filenameFromContentDisposition(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const utf8 = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : undefined;
}

/**
 * Downloads an app from `url` into a fresh temp directory and returns the
 * local path. The file keeps a recognisable extension so platform detection
 * and the upload content type work exactly as for a local file.
 *
 * Signed URLs (EAS Build, S3, GCS) expire; a 401/403 is reported as such
 * instead of a generic HTTP failure because that is the common cause.
 */
export async function downloadApp(
  rawUrl: string,
  options: { quiet?: boolean; log?: (message: string) => void } = {},
): Promise<{ filePath: string; tmpDir: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new TestingBotError(`Invalid --app-url: "${rawUrl}" is not a URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TestingBotError(
      `Invalid --app-url: only http(s) URLs are supported, got ${url.protocol}`,
    );
  }

  const log = options.log ?? (() => {});
  if (!options.quiet) log(`Downloading app from ${url.host}...`);

  let response;
  try {
    response = await axios.get(url.toString(), {
      responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxRedirects: 10,
      headers: { 'User-Agent': utils.getUserAgent() },
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      if (status === 401 || status === 403) {
        throw new TestingBotError(
          `The app URL was rejected (HTTP ${status}). Signed download links such as EAS Build URLs expire after about an hour; request a fresh URL and try again.`,
        );
      }
      if (status === 404) {
        throw new TestingBotError(
          `The app URL was not found (HTTP 404): ${url.origin}${url.pathname}`,
        );
      }
      throw new TestingBotError(
        `Failed to download the app (HTTP ${status}) from ${url.host}`,
      );
    }
    throw new TestingBotError(
      `Failed to download the app from ${url.host}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Work out a filename with a usable extension: URL path, then
  // Content-Disposition, then Content-Type.
  let filename = filenameFromUrl(url);
  if (!isSupportedAppExtension(filename)) {
    const fromHeader = filenameFromContentDisposition(
      response.headers?.['content-disposition'],
    );
    if (fromHeader && isSupportedAppExtension(fromHeader))
      filename = fromHeader;
  }
  if (!isSupportedAppExtension(filename)) {
    const contentType = String(response.headers?.['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const ext = CONTENT_TYPE_EXTENSIONS[contentType];
    if (ext) filename = `app${ext}`;
  }
  if (!isSupportedAppExtension(filename)) {
    response.data.destroy?.();
    throw new TestingBotError(
      `Cannot tell the app type from the URL (${filename || url.pathname}) or its headers. ` +
        `Expected one of ${APP_EXTENSIONS.join(', ')} in the file name.`,
    );
  }

  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'testingbot-app-'),
  );
  const filePath = path.join(tmpDir, path.basename(filename));
  try {
    await pipeline(response.data, fs.createWriteStream(filePath));
  } catch (error) {
    await fs.promises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => {});
    throw new TestingBotError(
      `Failed to save the downloaded app: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const size = (await fs.promises.stat(filePath)).size;
  if (size === 0) {
    await fs.promises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => {});
    throw new TestingBotError(`The app URL returned an empty file: ${rawUrl}`);
  }
  if (!options.quiet) {
    log(
      `Downloaded ${path.basename(filePath)} (${(size / 1024 / 1024).toFixed(1)} MB)`,
    );
  }
  return { filePath, tmpDir };
}

/**
 * Finds the shallowest `.app` bundle below `dir` without descending into
 * bundles themselves (they contain no nested apps we want).
 */
export async function findAppBundle(dir: string): Promise<string | undefined> {
  const queue: string[] = [dir];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    // Check this level fully before going deeper so the shallowest bundle wins.
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase().endsWith('.app')) {
        return path.join(current, entry.name);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(path.join(current, entry.name));
    }
  }
  return undefined;
}

/**
 * Extracts a `.tar.gz` (an EAS Build iOS simulator archive, typically) and
 * returns the `.app` bundle inside it. Uses the system `tar`, present on
 * macOS, Linux and Windows 10+ alike, so no extra dependency is needed.
 */
export async function extractAppBundle(
  archivePath: string,
): Promise<{ appPath: string; tmpDir: string }> {
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'testingbot-untar-'),
  );
  try {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', tmpDir], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    await fs.promises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => {});
    const detail =
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'the "tar" command is not available on this machine'
        : error instanceof Error
          ? error.message
          : String(error);
    throw new TestingBotError(
      `Failed to extract ${path.basename(archivePath)}: ${detail}`,
    );
  }

  const appPath = await findAppBundle(tmpDir);
  if (!appPath) {
    await fs.promises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => {});
    throw new TestingBotError(
      `No .app bundle found inside ${path.basename(archivePath)}. ` +
        'For Expo, use an iOS simulator build (an EAS profile with "ios.simulator": true); device builds produce an .ipa instead.',
    );
  }
  return { appPath, tmpDir };
}
