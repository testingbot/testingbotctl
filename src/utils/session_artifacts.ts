/**
 * `--download-artifacts` for Espresso and XCUITest: each run is one TestingBot
 * session, whose video, logs and screenshots the tests API serves once asset
 * processing has finished (`GET /v1/tests/:sessionId`). They are collected in a
 * folder per run and saved as one zip, the same layout `maestro` produces.
 */

import axios from 'axios';
import archiver from 'archiver';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import logger from '../logger';
import utils from '../utils';
import Credentials from '../models/credentials';
import { HTTP } from '../config/constants';

import type { ArtifactDownloadMode } from '../models/maestro_options';

export interface SessionArtifactRun {
  id: number;
  passed: boolean;
  sessionId?: string;
  device: string;
}

interface TestAssets {
  video?: string | false;
  logs?: Record<string, string> | unknown[];
  thumbs?: string[];
  assets_available?: boolean;
}

export interface SessionArtifactOptions {
  provider: 'espresso' | 'xcuitest';
  credentials: Credentials;
  runs: SessionArtifactRun[];
  mode: ArtifactDownloadMode;
  outputDir: string;
  /** --name; the zip is named after it when given. */
  name?: string;
  quiet?: boolean;
  /** How long to wait for asset processing per session. */
  waitMs?: number;
  pollMs?: number;
}

const TESTS_URL = 'https://api.testingbot.com/v1/tests';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A file-system-safe name: letters, digits, `.`, `_`, `-`. */
export function safeName(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^[_.-]+|[_.-]+$/g, '')
      .slice(0, 64) || 'run'
  );
}

async function fetchAssets(
  sessionId: string,
  credentials: Credentials,
  waitMs: number,
  pollMs: number,
): Promise<TestAssets> {
  const deadline = Date.now() + waitMs;
  while (true) {
    const response = await axios.get<TestAssets>(
      `${TESTS_URL}/${encodeURIComponent(sessionId)}`,
      {
        headers: { 'User-Agent': utils.getUserAgent() },
        auth: {
          username: credentials.userName,
          password: credentials.accessKey,
        },
        timeout: HTTP.TIMEOUT_MS,
      },
    );
    if (response.data.assets_available || Date.now() >= deadline) {
      return response.data;
    }
    await sleep(pollMs);
  }
}

async function downloadFile(url: string, filePath: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });
      await fs.promises.writeFile(filePath, response.data);
      return;
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status : 0;
      if (status && status >= 400 && status < 500) break;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

/** Downloads one session's assets into `dir`; returns how many files landed. */
async function saveAssets(
  assets: TestAssets,
  dir: string,
  quiet: boolean,
): Promise<number> {
  const files: Array<[string, string]> = [];
  if (assets.logs && !Array.isArray(assets.logs)) {
    for (const [name, url] of Object.entries(assets.logs)) {
      files.push([url, path.join('logs', `${safeName(name)}.txt`)]);
    }
  }
  if (typeof assets.video === 'string' && assets.video) {
    files.push([assets.video, path.join('video', 'video.mp4')]);
  }
  (assets.thumbs ?? []).forEach((url, i) => {
    files.push([url, path.join('screenshots', `screenshot_${i}.png`)]);
  });

  let saved = 0;
  for (const [url, relative] of files) {
    const target = path.join(dir, relative);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    try {
      await downloadFile(url, target);
      saved++;
      if (!quiet) logger.info(`    Downloaded ${relative}`);
    } catch (error) {
      logger.error(
        `    Failed to download ${relative}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return saved;
}

async function zipName(
  provider: string,
  outputDir: string,
  name?: string,
): Promise<string> {
  if (!name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${provider}_artifacts_${timestamp}.zip`;
  }
  const base = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    await fs.promises.access(path.join(outputDir, `${base}.zip`));
    return `${base}_${Date.now()}.zip`;
  } catch {
    return `${base}.zip`;
  }
}

function zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Downloads the artifacts of `runs` (all, or only the failed ones) into a zip
 * in `outputDir`. Returns the zip path, or undefined when nothing was saved.
 * Failures are logged, never thrown: artifacts must not fail a test run.
 */
export async function downloadSessionArtifacts(
  options: SessionArtifactOptions,
): Promise<string | undefined> {
  const quiet = !!options.quiet;
  const runs = options.runs.filter(
    (run) => options.mode === 'all' || !run.passed,
  );
  if (runs.length === 0) {
    if (!quiet) {
      logger.info(
        options.mode === 'failed'
          ? 'No failed runs to download artifacts for.'
          : 'No runs to download artifacts for.',
      );
    }
    return undefined;
  }
  if (!quiet) {
    logger.info(`Downloading artifacts for ${runs.length} run(s)...`);
  }

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `testingbot-${options.provider}-artifacts-`),
  );
  try {
    let saved = 0;
    for (const run of runs) {
      if (!run.sessionId) {
        logger.warn(`  Run ${run.id} has no session, skipping its artifacts.`);
        continue;
      }
      if (!quiet) logger.info(`  Run ${run.id} (${run.device}):`);
      try {
        const assets = await fetchAssets(
          run.sessionId,
          options.credentials,
          options.waitMs ?? 120000,
          options.pollMs ?? 5000,
        );
        const dir = path.join(tempDir, `${run.id}_${safeName(run.device)}`);
        saved += await saveAssets(assets, dir, quiet);
      } catch (error) {
        logger.error(
          `  Failed to fetch artifacts for run ${run.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (saved === 0) {
      logger.warn('No artifacts were available to download.');
      return undefined;
    }

    await fs.promises.mkdir(options.outputDir, { recursive: true });
    const zipPath = path.join(
      options.outputDir,
      await zipName(options.provider, options.outputDir, options.name),
    );
    await zipDirectory(tempDir, zipPath);
    if (!quiet) logger.info(`Artifacts saved to: ${zipPath}`);
    return zipPath;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}
