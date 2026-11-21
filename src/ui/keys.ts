import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import pc from 'picocolors';
import utils from '../utils';

/**
 * Single-key controls while a run is live:
 *   o       open the dashboard in the browser
 *   d       detach: exit and leave the runs going
 *   Ctrl-C  unchanged: raw mode turns it into a key, which is handed to the
 *           same handler SIGINT runs (calling it directly also works on
 *           Windows, where raising SIGINT would just kill the process)
 *
 * Only on an interactive terminal with a TTY stdin, in the foreground. The
 * terminal is restored on stop and on exit, whatever the reason.
 * TESTINGBOT_KEYS=0 turns the controls off.
 */

export interface KeyActions {
  open?: () => void;
  detach?: () => void;
  interrupt?: () => void;
}

let foregroundCache: boolean | undefined;

/**
 * Whether this process is in the terminal's foreground process group. A run
 * started with `&` is not: switching its terminal to raw mode (or reading
 * from it) would get it stopped by the shell ("suspended (tty output)").
 * Windows has no job control. When it cannot be told, assume background:
 * missing shortcuts are better than a stopped run.
 */
export function inForeground(): boolean {
  if (process.platform === 'win32') return true;
  if (foregroundCache !== undefined) return foregroundCache;
  foregroundCache = detectForeground();
  return foregroundCache;
}

function detectForeground(): boolean {
  try {
    // Linux: compare the process group with the terminal's foreground group.
    const stat = fs.readFileSync('/proc/self/stat', 'utf8');
    // "pid (comm) state ppid pgrp session tty_nr tpgid ..."; comm may hold
    // spaces or parentheses, so split after the last ")".
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const pgrp = Number(fields[2]);
    const tpgid = Number(fields[5]);
    if (Number.isInteger(pgrp) && Number.isInteger(tpgid)) {
      return pgrp === tpgid;
    }
  } catch {
    // No /proc (macOS, BSD): ask ps.
  }
  try {
    // "+" in the state: in the foreground process group of its terminal.
    const state = execFileSync(
      'ps',
      ['-o', 'stat=', '-p', String(process.pid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 },
    );
    return state.includes('+');
  } catch {
    return false;
  }
}

export function keyControlsAvailable(
  stdin: NodeJS.ReadStream = process.stdin,
  foreground: () => boolean = inForeground,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.TESTINGBOT_KEYS !== '0' &&
    utils.isInteractive() &&
    Boolean(stdin.isTTY) &&
    typeof stdin.setRawMode === 'function' &&
    foreground()
  );
}

/** The dim hint line shown under the run's links. */
export function keyHint(actions: KeyActions, ctrlC: string): string {
  const parts = [
    actions.open && `${pc.bold('o')} open dashboard`,
    actions.detach && `${pc.bold('d')} detach (runs keep going)`,
    `${pc.bold('Ctrl-C')} ${ctrlC}`,
  ].filter(Boolean);
  return pc.dim(`  ${parts.join(pc.dim(' · '))}`);
}

/** Starts listening; returns the function that stops and restores the TTY. */
export function startKeyControls(
  actions: KeyActions,
  stdin: NodeJS.ReadStream = process.stdin,
  foreground: () => boolean = inForeground,
): () => void {
  if (!keyControlsAvailable(stdin, foreground)) return () => undefined;

  const onData = (data: Buffer | string) => {
    const key = data.toString();
    if (key === '\u0003') {
      if (actions.interrupt) actions.interrupt();
      else process.kill(process.pid, 'SIGINT');
      return;
    }
    const k = key.toLowerCase();
    if (k === 'o') actions.open?.();
    else if (k === 'd') actions.detach?.();
  };

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stdin.off('data', onData);
    try {
      stdin.setRawMode(false);
    } catch {
      // The TTY may already be gone.
    }
    stdin.pause();
    process.off('exit', stop);
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);
  process.on('exit', stop);
  return stop;
}
