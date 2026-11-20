import utils from '../utils';

/**
 * Terminal capability helpers: clickable links (OSC 8), "run finished"
 * notifications (BEL / OSC 9 / OSC 99) and tab/taskbar progress (OSC 9;4).
 *
 * Every escape sequence here is only written to an interactive terminal (a
 * TTY outside CI) that is known to understand it, so CI logs and pipes never
 * carry control sequences. Detection follows the environment variables the
 * terminals themselves set; each feature can be forced on or off.
 */

type Env = NodeJS.ProcessEnv;

const ESC = '\x1b';
const BEL = '\x07';

function versionAtLeast(version: string | undefined, min: number[]): boolean {
  if (!version) return false;
  const parts = version.split(/[.-]/).map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < min.length; i++) {
    const v = Number.isFinite(parts[i]) ? parts[i] : 0;
    if (v > min[i]) return true;
    if (v < min[i]) return false;
  }
  return true;
}

function forced(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return !(value === '0' || value.toLowerCase() === 'false');
}

/** Whether `stream` is a terminal that renders OSC 8 hyperlinks. */
export function supportsHyperlinks(
  env: Env = process.env,
  interactive: boolean = utils.isInteractive(),
): boolean {
  const force = forced(env.FORCE_HYPERLINK);
  if (force !== undefined) return force;
  if (!interactive) return false;
  if (env.WT_SESSION) return true; // Windows Terminal
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return true;
  if (env.TERM === 'alacritty') return true;
  if (env.KONSOLE_VERSION && Number(env.KONSOLE_VERSION) >= 210400) {
    return true;
  }
  if (env.VTE_VERSION && Number(env.VTE_VERSION) >= 5000) return true;
  switch (env.TERM_PROGRAM) {
    case 'iTerm.app':
      return versionAtLeast(env.TERM_PROGRAM_VERSION, [3, 1]);
    case 'WezTerm':
    case 'ghostty':
    case 'Hyper':
      return true;
    case 'vscode':
      return versionAtLeast(env.TERM_PROGRAM_VERSION, [1, 72]);
    default:
      return false;
  }
}

/**
 * Renders `text` as a clickable link to `url` where supported; elsewhere the
 * plain text, followed by the URL when the two differ, so nothing is lost.
 */
export function link(
  text: string,
  url: string,
  enabled: boolean = supportsHyperlinks(),
): string {
  if (enabled) {
    return `${ESC}]8;;${url}${BEL}${text}${ESC}]8;;${BEL}`;
  }
  return text === url ? url : `${text} (${url})`;
}

/** A URL that is clickable where supported and printed as-is elsewhere. */
export function linkUrl(url: string, enabled?: boolean): string {
  return link(url, url, enabled);
}

type NotifyProtocol = 'osc9' | 'osc99' | 'bell';

/** The richest notification the terminal understands. */
export function notificationProtocol(env: Env = process.env): NotifyProtocol {
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return 'osc99';
  switch (env.TERM_PROGRAM) {
    case 'iTerm.app':
    case 'ghostty':
    case 'WezTerm':
      return 'osc9';
    default:
      return 'bell';
  }
}

/** Whether a finished run may notify: interactive and not turned off. */
export function notificationsEnabled(
  env: Env = process.env,
  interactive: boolean = utils.isInteractive(),
): boolean {
  const force = forced(env.TESTINGBOT_NOTIFY);
  if (force !== undefined) return force && interactive;
  return interactive;
}

/** Runs shorter than this finish while the user is still watching. */
export const NOTIFY_AFTER_MS = 60_000;

/**
 * Tells the user a long run has finished, even when the terminal is in the
 * background: a desktop notification where the terminal supports one (iTerm2,
 * Ghostty, WezTerm, kitty), otherwise the terminal bell (a dock bounce or tab
 * badge in most terminals). TESTINGBOT_NOTIFY=0 turns it off.
 */
export function notifyFinished(
  message: string,
  elapsedMs: number,
  {
    env = process.env,
    interactive = utils.isInteractive(),
    write = (s: string) => process.stdout.write(s),
  }: {
    env?: Env;
    interactive?: boolean;
    write?: (s: string) => unknown;
  } = {},
): boolean {
  if (elapsedMs < NOTIFY_AFTER_MS) return false;
  if (!notificationsEnabled(env, interactive)) return false;
  // Notification text must not contain the terminator or other controls.
  // eslint-disable-next-line no-control-regex
  const text = message.replace(/[\x00-\x1f\x7f]/g, ' ');
  switch (notificationProtocol(env)) {
    case 'osc9':
      write(`${ESC}]9;${text}${BEL}`);
      break;
    case 'osc99':
      write(`${ESC}]99;;${text}${ESC}\\`);
      break;
    default:
      write(BEL);
  }
  return true;
}

/** Whether the terminal shows OSC 9;4 progress on its tab or taskbar. */
export function supportsProgress(
  env: Env = process.env,
  interactive: boolean = utils.isInteractive(),
): boolean {
  const force = forced(env.TESTINGBOT_TERM_PROGRESS);
  if (force !== undefined) return force && interactive;
  if (!interactive) return false;
  if (env.WT_SESSION || env.ConEmuANSI === 'ON') return true;
  if (env.TERM_PROGRAM === 'ghostty') return true;
  if (env.TERM_PROGRAM === 'iTerm.app') {
    return versionAtLeast(env.TERM_PROGRAM_VERSION, [3, 6, 6]);
  }
  return false;
}

export type ProgressState = 'normal' | 'error' | 'indeterminate' | 'warning';

const PROGRESS_STATE_CODE: Record<ProgressState, number> = {
  normal: 1,
  error: 2,
  indeterminate: 3,
  warning: 4,
};

let progressShown = false;
let progressExitHook = false;

/**
 * Shows progress on the terminal tab / Windows taskbar. `percent` is ignored
 * for the indeterminate state. Cleared automatically when the process exits.
 */
export function setProgress(
  state: ProgressState,
  percent = 0,
  enabled: boolean = supportsProgress(),
): void {
  if (!enabled) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  process.stdout.write(
    `${ESC}]9;4;${PROGRESS_STATE_CODE[state]};${state === 'indeterminate' ? 0 : value}${BEL}`,
  );
  progressShown = true;
  if (!progressExitHook) {
    progressExitHook = true;
    process.on('exit', () => clearProgress());
  }
}

/** Removes the tab/taskbar progress indicator, if one is shown. */
export function clearProgress(): void {
  if (!progressShown) return;
  progressShown = false;
  process.stdout.write(`${ESC}]9;4;0;0${BEL}`);
}
