import https from 'node:https';
import pc from 'picocolors';
import packageJson from '../../package.json';
import { readState, updateState } from './state';

/**
 * Update notifier. Two sources tell the CLI about a newer release:
 *
 * - the `x-testingbotctl-version` header on TestingBot API responses, and
 * - a check of the npm registry, at most once a day, in the background.
 *
 * Neither prints anything mid-run. The newest version seen is remembered and,
 * when the command ends, one line on stderr mentions it (at most once a day).
 * Never in CI, never when stderr is not a terminal, and never for
 * `testingbot completion`, whose output a shell reads.
 */

const STATE_FILE = 'update-check.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/@testingbot/cli/latest';
const REGISTRY_TIMEOUT_MS = 3000;

interface UpdateState {
  lastCheckAt?: number;
  latestVersion?: string;
  lastNoticeAt?: number;
}

/** -1, 0 or 1. Pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function updateChecksEnabled(
  env: NodeJS.ProcessEnv = process.env,
  stderrIsTTY: boolean = Boolean(process.stderr.isTTY),
): boolean {
  if (env.CI) return false;
  if (env.NO_UPDATE_NOTIFIER || env.TESTINGBOT_NO_UPDATE_CHECK) return false;
  return stderrIsTTY;
}

let latestSeen: string | undefined;

/** Remembers a version announced by the API. Prints nothing. */
export function recordLatestVersion(version: string | undefined): void {
  if (!version || !/^\d+(\.\d+)*$/.test(version.trim())) return;
  const v = version.trim();
  if (latestSeen && compareVersions(latestSeen, v) >= 0) return;
  latestSeen = v;
  const state = readState<UpdateState>(STATE_FILE) ?? {};
  if (!state.latestVersion || compareVersions(state.latestVersion, v) < 0) {
    updateState<UpdateState>(STATE_FILE, { latestVersion: v });
  }
}

/**
 * Asks the npm registry for the latest version when the last check is more
 * than a day old. Fire-and-forget: the socket is unref'd so a slow registry
 * never keeps the CLI from exiting; an unanswered check is simply retried on
 * the next run.
 */
export function refreshLatestVersionInBackground(
  now: number = Date.now(),
): void {
  const state = readState<UpdateState>(STATE_FILE) ?? {};
  if (state.lastCheckAt && now - state.lastCheckAt < CHECK_INTERVAL_MS) return;
  try {
    const req = https.get(
      REGISTRY_URL,
      { headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (body.length < 64 * 1024) body += chunk;
        });
        res.on('end', () => {
          try {
            const version = (JSON.parse(body) as { version?: unknown }).version;
            updateState<UpdateState>(STATE_FILE, { lastCheckAt: Date.now() });
            if (typeof version === 'string') recordLatestVersion(version);
          } catch {
            // Ignore malformed responses.
          }
        });
      },
    );
    req.setTimeout(REGISTRY_TIMEOUT_MS, () => req.destroy());
    req.on('socket', (socket) => socket.unref());
    req.on('error', () => undefined);
  } catch {
    // Never let the update check affect the command.
  }
}

/** The one-line notice, or undefined when no newer version is known. */
export function updateNotice(
  current: string = packageJson.version,
  now: number = Date.now(),
): string | undefined {
  const state = readState<UpdateState>(STATE_FILE) ?? {};
  const latest =
    latestSeen &&
    (!state.latestVersion ||
      compareVersions(latestSeen, state.latestVersion) > 0)
      ? latestSeen
      : state.latestVersion;
  if (!latest || compareVersions(current, latest) >= 0) return undefined;
  if (state.lastNoticeAt && now - state.lastNoticeAt < NOTICE_INTERVAL_MS) {
    return undefined;
  }
  updateState<UpdateState>(STATE_FILE, { lastNoticeAt: now });
  return `${pc.yellow('⬆')} Update available ${pc.dim(current)} → ${pc.green(latest)}  ${pc.dim('·')}  ${pc.cyan('npm install -g @testingbot/cli')}`;
}

let installed = false;

/**
 * Starts the background check and prints the notice when the process exits.
 * Call once per command, before it runs.
 */
export function installUpdateNotifier(): void {
  if (installed || !updateChecksEnabled()) return;
  installed = true;
  refreshLatestVersionInBackground();
  process.on('exit', () => {
    try {
      const notice = updateNotice();
      if (notice) process.stderr.write(`\n${notice}\n`);
    } catch {
      // Ignore.
    }
  });
}

/** For tests. */
export function resetUpdateNotifierForTests(): void {
  latestSeen = undefined;
  installed = false;
}
