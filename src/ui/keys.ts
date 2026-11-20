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
 * Only on an interactive terminal with a TTY stdin. The terminal is restored
 * on stop and on exit, whatever the reason.
 */

export interface KeyActions {
  open?: () => void;
  detach?: () => void;
  interrupt?: () => void;
}

export function keyControlsAvailable(
  stdin: NodeJS.ReadStream = process.stdin,
): boolean {
  return (
    utils.isInteractive() &&
    Boolean(stdin.isTTY) &&
    typeof stdin.setRawMode === 'function'
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
): () => void {
  if (!keyControlsAvailable(stdin)) return () => undefined;

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
