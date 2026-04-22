import utils from '../utils';

/**
 * Updates the terminal tab/window title via the OSC 2 escape sequence.
 * No-op in CI or when stdout isn't a TTY — CI logs shouldn't carry control
 * sequences, and non-interactive consumers wouldn't see the effect anyway.
 *
 * An exit handler (installed lazily) resets the title so the user's shell
 * doesn't keep our last status after the CLI exits.
 */

const RESET_TITLE = 'Terminal';
let exitHookInstalled = false;
let lastSetTitle: string | null = null;

function canWriteTitle(): boolean {
  return utils.isInteractive();
}

function writeOsc(title: string): void {
  // OSC 0 sets both the icon/tab title AND the window title. iTerm2 shows
  // the session name in the tab and ignores OSC 2 (window-title-only), so
  // OSC 0 is the portable choice across Terminal.app, iTerm2, most Linux
  // terminals, and Windows Terminal.
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const reset = () => {
    if (canWriteTitle() && lastSetTitle !== null) {
      writeOsc(RESET_TITLE);
    }
  };
  process.on('exit', reset);
}

export function setTitle(title: string): void {
  if (!canWriteTitle()) return;
  const full = `testingbot · ${title}`;
  if (full === lastSetTitle) return;
  lastSetTitle = full;
  writeOsc(full);
  installExitHook();
}

export function resetTitle(): void {
  if (!canWriteTitle()) return;
  lastSetTitle = null;
  writeOsc(RESET_TITLE);
}

export default { setTitle, resetTitle };
