import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Small, best-effort store for things the CLI remembers between runs: when it
 * last checked for an update, cached device catalogs for shell completion and
 * the device-name check, and first-run state.
 *
 * Lives in $XDG_CONFIG_HOME/testingbot (default ~/.config/testingbot); ~/.testingbot
 * itself is the credentials file. Every read and write swallows errors: a
 * read-only home directory must never break a test run.
 */

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : path.join(os.homedir(), '.config');
  return path.join(base, 'testingbot');
}

function statePath(name: string): string {
  return path.join(stateDir(), name);
}

export function readState<T>(name: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(statePath(name), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function writeState(name: string, value: unknown): void {
  try {
    const file = statePath(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename so a concurrent reader never sees half a file.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    // Best effort only.
  }
}

/** Merges `patch` into the JSON object stored under `name`. */
export function updateState<T extends object>(
  name: string,
  patch: Partial<T>,
): T {
  const next = { ...(readState<T>(name) ?? ({} as T)), ...patch };
  writeState(name, next);
  return next;
}
