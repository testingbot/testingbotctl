import { spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import pc from 'picocolors';
import packageJson from '../../package.json';
import { compareVersions, recordLatestVersion } from '../utils/update_check';

/**
 * `testingbot upgrade`: updates the CLI the way it was installed. A global
 * install (npm, pnpm, yarn, bun) is updated in place; a project dependency,
 * an npx run or a source checkout only gets the command to run, because
 * changing a package.json or a checkout is the user's call.
 */

const PACKAGE = '@testingbot/cli';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const REGISTRY_TIMEOUT_MS = 10000;

export type InstallKind =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'project'
  | 'npx'
  | 'source'
  | 'unknown';

export interface Install {
  kind: InstallKind;
  /** The update command; run for global installs, printed otherwise. */
  command: string[];
  /** Whether `upgrade` runs the command itself. */
  runnable: boolean;
  /** Where to run it (the project, for a project dependency). */
  cwd?: string;
}

function projectManager(projectDir: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  const has = (f: string) => fs.existsSync(path.join(projectDir, f));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}

function insideGitCheckout(dir: string): boolean {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

/** How the running CLI was installed, from the path of its entry script. */
export function detectInstall(script: string = process.argv[1] ?? ''): Install {
  let real = script;
  try {
    real = fs.realpathSync(script);
  } catch {
    // Keep the path as given.
  }
  const p = real.replace(/\\/g, '/');
  const marker = `/node_modules/${PACKAGE}/`;
  const at = p.lastIndexOf(marker);
  const latest = `${PACKAGE}@latest`;

  if (at === -1) {
    if (insideGitCheckout(path.dirname(real))) {
      return {
        kind: 'source',
        command: ['git pull && npm install && npm run build'],
        runnable: false,
      };
    }
    // A copy of the CLI outside node_modules: npm is the usual way back.
    return {
      kind: 'unknown',
      command: ['npm', 'install', '-g', latest],
      runnable: false,
    };
  }
  if (p.includes('/_npx/')) {
    return { kind: 'npx', command: ['npx', latest], runnable: false };
  }
  if (p.includes('/.bun/install/global/')) {
    return {
      kind: 'bun',
      command: ['bun', 'add', '-g', latest],
      runnable: true,
    };
  }
  if (/\/pnpm\/global\/|\/pnpm-global\/|\/\.pnpm-global\//i.test(p)) {
    return {
      kind: 'pnpm',
      command: ['pnpm', 'add', '-g', latest],
      runnable: true,
    };
  }
  if (/\/yarn\/global\/|\/\.yarn\/global\/|\/Yarn\/Data\/global\//i.test(p)) {
    return {
      kind: 'yarn',
      command: ['yarn', 'global', 'add', latest],
      runnable: true,
    };
  }

  // A project's own node_modules: the directory above it has a package.json
  // (a global prefix, such as /usr/local/lib, has none).
  const projectDir = p.slice(0, at);
  if (fs.existsSync(path.join(projectDir, 'package.json'))) {
    const manager = projectManager(projectDir);
    const command = {
      npm: ['npm', 'install', '--save-dev', latest],
      pnpm: ['pnpm', 'add', '-D', latest],
      yarn: ['yarn', 'add', '-D', latest],
      bun: ['bun', 'add', '-d', latest],
    }[manager];
    return { kind: 'project', command, runnable: false, cwd: projectDir };
  }
  return {
    kind: 'npm',
    command: ['npm', 'install', '-g', latest],
    runnable: true,
  };
}

/** The latest published version, or undefined when npm cannot be reached. */
export function fetchLatestVersion(
  url: string = REGISTRY_URL,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const req = https.get(
        url,
        { headers: { Accept: 'application/json' } },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (body.length < 64 * 1024) body += chunk;
          });
          res.on('end', () => {
            try {
              const version = (JSON.parse(body) as { version?: unknown })
                .version;
              resolve(typeof version === 'string' ? version : undefined);
            } catch {
              resolve(undefined);
            }
          });
        },
      );
      req.setTimeout(REGISTRY_TIMEOUT_MS, () => req.destroy());
      req.on('error', () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}

export interface UpgradeDeps {
  current: string;
  latest: () => Promise<string | undefined>;
  install: Install;
  /** Runs the command; resolves with its exit code. */
  run: (command: string[], cwd?: string) => Promise<number>;
  log: (line: string) => void;
}

function runCommand(command: string[], cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      // npm, pnpm and yarn are .cmd scripts on Windows.
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(127));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const defaultDeps = (): UpgradeDeps => ({
  current: packageJson.version,
  latest: () => fetchLatestVersion(),
  install: detectInstall(),
  run: runCommand,
  log: (line) => console.log(line),
});

const HOW: Record<InstallKind, string> = {
  npm: 'installed globally with npm',
  pnpm: 'installed globally with pnpm',
  yarn: 'installed globally with yarn',
  bun: 'installed globally with bun',
  project: 'a dependency of the project',
  npx: 'run through npx',
  source: 'run from a source checkout',
  unknown: 'not installed by a package manager',
};

/**
 * Returns the exit code: 0 when up to date or updated, 1 when the update
 * failed or the latest version is unknown.
 */
export async function runUpgrade(
  options: { dryRun?: boolean } = {},
  deps: Partial<UpgradeDeps> = {},
): Promise<number> {
  const d = { ...defaultDeps(), ...deps };
  const { install, log } = d;
  const shown = install.command.join(' ');

  const latest = await d.latest();
  if (!latest) {
    log(
      `${pc.red('✘')} Could not reach the npm registry to find the latest version.`,
    );
    if (install.runnable) log(`  Update by hand: ${pc.cyan(shown)}`);
    return 1;
  }
  recordLatestVersion(latest);
  if (compareVersions(d.current, latest) >= 0) {
    log(`${pc.green('✔')} TestingBot CLI ${d.current} is the latest version.`);
    return 0;
  }

  log(
    `${pc.yellow('⬆')} ${d.current} → ${pc.green(latest)}  ${pc.dim(`(${HOW[install.kind]})`)}`,
  );
  if (install.kind === 'npx') {
    log(`  npx runs the latest version with: ${pc.cyan(shown)}`);
    return 0;
  }
  if (!install.runnable) {
    const where =
      install.kind === 'project' && install.cwd ? ` in ${install.cwd}` : '';
    log(`  Update it${where} with: ${pc.cyan(shown)}`);
    return 0;
  }
  if (options.dryRun) {
    log(`  Would run: ${pc.cyan(shown)}`);
    return 0;
  }

  log(`  Running: ${pc.cyan(shown)}`);
  const code = await d.run(install.command, install.cwd);
  if (code === 0) {
    log(`${pc.green('✔')} Updated to ${latest}.`);
    return 0;
  }
  log(`${pc.red('✘')} The update failed (exit ${code}).`);
  if (install.kind === 'npm' && process.platform !== 'win32') {
    log(
      `  A permission error ("EACCES") means npm's global folder is not yours: run ${pc.cyan(`sudo ${shown}`)}, or install Node.js with a version manager such as nvm.`,
    );
  }
  return 1;
}
