import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import pc from 'picocolors';
import packageJson from '../../package.json';
import Auth, { type CredentialSource } from '../auth';
import { fetchAccount, type AccountInfo } from '../providers/account';
import type Credentials from '../models/credentials';
import { activeProxyFor, redactProxy } from '../utils/proxy';
import { compareVersions } from '../utils/update_check';
import { findConfigFile, loadProjectConfig } from '../config/project_config';
import { detectShell } from './completion';
import {
  notificationProtocol,
  supportsHyperlinks,
  supportsProgress,
} from '../ui/terminal';
import utils from '../utils';

/**
 * `testingbot doctor`: checks everything a run depends on and says what to
 * fix. Useful on its own, and its --json output is what support asks for.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorDeps {
  nodeVersion: string;
  cliVersion: string;
  latestVersion: () => Promise<string | undefined>;
  resolveCredentials: () => Promise<{
    credentials: Credentials;
    source: CredentialSource;
  } | null>;
  fetchAccount: (credentials: Credentials) => Promise<AccountInfo>;
  pingApi: () => Promise<void>;
  proxy: () => string | undefined;
  configFile: () => string | undefined;
  completionInstalled: () => boolean | undefined;
  now: () => number;
}

const MIN_NODE_MAJOR = 20;

async function npmLatest(): Promise<string | undefined> {
  const response = await axios.get<{ version?: string }>(
    'https://registry.npmjs.org/@testingbot/cli/latest',
    { timeout: 4000, headers: { 'User-Agent': utils.getUserAgent() } },
  );
  return typeof response.data?.version === 'string'
    ? response.data.version
    : undefined;
}

async function pingApi(): Promise<void> {
  // Public endpoint: reachability without credentials.
  await axios.get('https://api.testingbot.com/v1/browsers/maestro', {
    timeout: 8000,
    headers: { 'User-Agent': utils.getUserAgent() },
  });
}

/** Whether the user's shell loads `testingbot completion`. */
function completionInstalled(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const shell = detectShell(env);
  const home = os.homedir();
  const files: Record<string, string[]> = {
    bash: ['.bashrc', '.bash_profile', '.profile'],
    zsh: ['.zshrc', '.zprofile'],
    fish: [
      '.config/fish/completions/testingbot.fish',
      '.config/fish/config.fish',
    ],
  };
  if (!shell) return undefined;
  return files[shell].some((f) => {
    try {
      return fs.readFileSync(path.join(home, f), 'utf8').includes('testingbot');
    } catch {
      return false;
    }
  });
}

export const defaultDeps: DoctorDeps = {
  nodeVersion: process.versions.node,
  cliVersion: packageJson.version,
  latestVersion: npmLatest,
  resolveCredentials: () => Auth.resolveCredentials({}),
  fetchAccount,
  pingApi,
  proxy: () => activeProxyFor('https://api.testingbot.com'),
  configFile: () => findConfigFile(),
  completionInstalled: () => completionInstalled(),
  now: () => Date.now(),
};

const SOURCE_LABEL: Record<CredentialSource, string> = {
  options: '--api-key / --api-secret',
  env: 'TB_KEY / TB_SECRET',
  file: '~/.testingbot',
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

export async function runChecks(
  deps: DoctorDeps = defaultDeps,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // CLI version
  let latest: string | undefined;
  try {
    latest = await deps.latestVersion();
  } catch {
    latest = undefined;
  }
  if (latest && compareVersions(deps.cliVersion, latest) < 0) {
    results.push({
      name: 'CLI',
      status: 'warn',
      detail: `${deps.cliVersion}, ${latest} is available`,
      hint: 'testingbot upgrade',
    });
  } else {
    results.push({
      name: 'CLI',
      status: 'ok',
      detail: latest ? `${deps.cliVersion} (latest)` : deps.cliVersion,
    });
  }

  // Node.js
  const major = Number.parseInt(deps.nodeVersion, 10);
  results.push(
    major >= MIN_NODE_MAJOR
      ? { name: 'Node.js', status: 'ok', detail: `v${deps.nodeVersion}` }
      : {
          name: 'Node.js',
          status: 'fail',
          detail: `v${deps.nodeVersion}, the CLI needs ${MIN_NODE_MAJOR} or newer`,
          hint: 'Install a current Node.js LTS release',
        },
  );

  // Proxy
  const proxy = deps.proxy();
  results.push({
    name: 'Proxy',
    status: 'info',
    detail: proxy ? redactProxy(proxy) : 'none',
  });

  // Credentials, account and API
  let resolved: Awaited<ReturnType<DoctorDeps['resolveCredentials']>> = null;
  try {
    resolved = await deps.resolveCredentials();
  } catch (error) {
    results.push({
      name: 'Credentials',
      status: 'fail',
      detail: errorText(error),
      hint: 'testingbot login',
    });
  }
  if (!resolved && !results.some((r) => r.name === 'Credentials')) {
    results.push({
      name: 'Credentials',
      status: 'fail',
      detail: 'none found',
      hint: 'testingbot login (or set TB_KEY and TB_SECRET)',
    });
  }
  const started = deps.now();
  if (resolved) {
    const key = resolved.credentials.userName;
    results.push({
      name: 'Credentials',
      status: 'ok',
      detail: `${SOURCE_LABEL[resolved.source]} · key ${key.slice(0, 4)}…`,
    });
    try {
      const account = await deps.fetchAccount(resolved.credentials);
      const ms = deps.now() - started;
      results.push({
        name: 'API',
        status: 'ok',
        detail: `api.testingbot.com reachable (${ms} ms)`,
      });
      const c = account.concurrency;
      const parts = [
        account.name || `account ${account.id}`,
        account.plan && `${account.plan} plan`,
        account.minutesLeft !== undefined &&
          `${account.minutesLeft.toLocaleString('en-US')} minutes left`,
        `${c.runningVirtual ?? 0}/${c.virtual ?? '?'} virtual, ${c.runningPhysical ?? 0}/${c.physical ?? '?'} real in use`,
      ].filter(Boolean);
      const noMinutes = account.minutesLeft === 0;
      results.push({
        name: 'Account',
        status: noMinutes ? 'warn' : 'ok',
        detail: parts.join(' · '),
        ...(noMinutes && { hint: 'https://testingbot.com/pricing' }),
      });
    } catch (error) {
      const message = errorText(error);
      const auth = /401|unauthori[sz]ed|credentials/i.test(message);
      results.push(
        auth
          ? {
              name: 'Credentials',
              status: 'fail',
              detail: 'rejected by TestingBot',
              hint: 'testingbot login',
            }
          : {
              name: 'API',
              status: 'fail',
              detail: `cannot reach api.testingbot.com: ${message}`,
              hint: proxy
                ? 'Check that the proxy allows *.testingbot.com'
                : 'Check your network, or set HTTPS_PROXY',
            },
      );
    }
  } else {
    try {
      await deps.pingApi();
      results.push({
        name: 'API',
        status: 'ok',
        detail: `api.testingbot.com reachable (${deps.now() - started} ms)`,
      });
    } catch (error) {
      results.push({
        name: 'API',
        status: 'fail',
        detail: `cannot reach api.testingbot.com: ${errorText(error)}`,
        hint: 'Check your network, or set HTTPS_PROXY',
      });
    }
  }

  // Project config
  try {
    const file = deps.configFile();
    if (file) {
      const config = loadProjectConfig(file);
      const commands = Object.keys(config.commands);
      results.push({
        name: 'Config',
        status: 'ok',
        detail: `${path.relative(process.cwd(), file) || file} (${commands.join(', ') || 'empty'})`,
      });
    } else {
      results.push({
        name: 'Config',
        status: 'info',
        detail: 'no .testingbot.yml',
        hint: 'testingbot init',
      });
    }
  } catch (error) {
    results.push({
      name: 'Config',
      status: 'fail',
      detail: errorText(error),
    });
  }

  // Shell completion
  const completion = deps.completionInstalled();
  if (completion !== undefined) {
    results.push(
      completion
        ? { name: 'Completion', status: 'ok', detail: 'installed' }
        : {
            name: 'Completion',
            status: 'info',
            detail: 'not installed',
            hint: 'testingbot completion --help',
          },
    );
  }

  return results;
}

/** What this terminal supports, for the human report only. */
export function terminalSummary(): string {
  const yes = (b: boolean) => (b ? pc.green('yes') : pc.dim('no'));
  return `links ${yes(supportsHyperlinks())} · notifications ${
    utils.isInteractive() ? notificationProtocol() : pc.dim('no')
  } · tab progress ${yes(supportsProgress())}`;
}

const SYMBOL: Record<CheckStatus, string> = {
  ok: pc.green('✔'),
  warn: pc.yellow('!'),
  fail: pc.red('✘'),
  info: pc.dim('•'),
};

export function renderChecks(results: CheckResult[]): string[] {
  const width = Math.max(...results.map((r) => r.name.length), 8);
  const lines = results.map((r) => {
    const detail = r.status === 'fail' ? pc.red(r.detail) : r.detail;
    const hint = r.hint ? pc.dim(`  → ${r.hint}`) : '';
    return `  ${SYMBOL[r.status]} ${r.name.padEnd(width)}  ${detail}${hint}`;
  });
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  lines.push('');
  lines.push(
    failed > 0
      ? pc.red(`${failed} problem${failed === 1 ? '' : 's'} to fix.`)
      : warned > 0
        ? pc.yellow('Ready to run, with a warning above.')
        : pc.green('Everything looks good.'),
  );
  return lines;
}
