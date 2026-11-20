import pc from 'picocolors';
import os from 'node:os';
import path from 'node:path';
import utils from '../utils';
import packageJson from '../../package.json';
import { readState, writeState } from '../utils/state';
import { findConfigFile } from '../config/project_config';

// Hand-crafted 3-row block letters for TESTINGBOT using half-block
// characters (▀ ▄ █) so each text row encodes two pixel rows — same
// readability as a 5-row font, half the vertical space.
const LETTERS: Record<string, string[]> = {
  T: ['▀█▀', ' █ ', ' ▀ '],
  E: ['█▀▀', '█▀ ', '▀▀▀'],
  S: ['▄▀▀▀', ' ▀▀▄', '▀▀▀ '],
  I: ['▀█▀', ' █ ', '▀▀▀'],
  N: ['█▄ █', '█ ▀█', '▀  ▀'],
  G: ['▄▀▀▀', '█ ▀█', ' ▀▀▀'],
  B: ['█▀▀▄', '█▀▀▄', '▀▀▀ '],
  O: ['█▀▀█', '█  █', '▀▀▀▀'],
};

const WORD = 'TESTINGBOT';
const LETTER_GAP = ' ';
const LETTER_ROWS = 3;

/** Blue → cyan across the word (xterm-256 colour indexes). */
const GRADIENT = [27, 33, 39, 45, 51];
const BANNER_STATE = 'banner.json';

export type BannerMode = 'full' | 'compact' | 'off';

export function buildBigText(): string[] {
  const rows: string[] = [];
  for (let r = 0; r < LETTER_ROWS; r++) {
    const parts = WORD.split('').map((ch) => LETTERS[ch][r]);
    rows.push(parts.join(LETTER_GAP));
  }
  return rows;
}

function shouldSkipBanner(argv: string[]): boolean {
  if (!utils.isInteractive()) return true;
  // Output a shell or a script reads.
  if (argv[0] === 'completion' || argv[0] === '__complete') return true;
  for (const arg of argv) {
    if (
      arg === '--help' ||
      arg === '-h' ||
      arg === '--version' ||
      arg === '-v' ||
      arg === '-V' ||
      arg === '--quiet' ||
      arg === '-q' ||
      arg === '--json'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The full banner greets each new version once; after that a one-line header
 * keeps the scrollback short. TESTINGBOT_BANNER=full|compact|off overrides.
 */
export function bannerMode(
  env: NodeJS.ProcessEnv = process.env,
  version: string = packageJson.version,
): BannerMode {
  const forced = env.TESTINGBOT_BANNER?.toLowerCase();
  if (forced === 'full' || forced === 'compact' || forced === 'off') {
    return forced;
  }
  const state = readState<{ fullShownFor?: string }>(BANNER_STATE);
  return state?.fullShownFor === version ? 'compact' : 'full';
}

function paint(text: string, column: number, width: number, highlight = -99) {
  if (!pc.isColorSupported) return text;
  const chars = Array.from(text);
  return chars
    .map((ch, i) => {
      if (ch === ' ') return ch;
      const col = column + i;
      if (Math.abs(col - highlight) <= 1) return `\x1b[97m${ch}\x1b[39m`;
      const g =
        GRADIENT[
          Math.min(
            GRADIENT.length - 1,
            Math.floor((col / width) * GRADIENT.length),
          )
        ];
      return `\x1b[38;5;${g}m${ch}\x1b[39m`;
    })
    .join('');
}

function context(): string {
  const home = os.homedir();
  const raw = process.cwd();
  const cwd = raw.startsWith(home) ? '~' + raw.slice(home.length) : raw;
  let config = '';
  try {
    const file = findConfigFile();
    if (file) config = ` · ${path.basename(file)}`;
  } catch {
    // A bad TESTINGBOT_CONFIG is reported by the command itself.
  }
  return `${cwd}${config}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function printBanner(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  if (shouldSkipBanner(argv)) return;
  const mode = bannerMode();
  if (mode === 'off') return;
  const version = `v${packageJson.version}`;

  if (mode === 'compact') {
    console.log(
      `${pc.bold(pc.blue('▌TestingBot'))} ${pc.dim(`${version} · ${context()}`)}`,
    );
    console.log();
    return;
  }

  const rows = buildBigText();
  const width = Math.max(...rows.map((r) => Array.from(r).length));
  const draw = (highlight: number) =>
    rows.map((row) => '  ' + paint(row, 0, width, highlight));

  console.log();
  if (pc.isColorSupported) {
    // One shimmer across the word, ~0.3s, then the resting gradient.
    process.stdout.write('\x1b[?25l');
    const restoreCursor = () => process.stdout.write('\x1b[?25h');
    process.once('exit', restoreCursor);
    try {
      for (let h = -2; h <= width + 2; h += 4) {
        process.stdout.write(draw(h).join('\n') + '\n');
        await sleep(22);
        process.stdout.write(`\x1b[${LETTER_ROWS}A`);
      }
    } finally {
      restoreCursor();
      process.off('exit', restoreCursor);
    }
  }
  console.log(draw(-99).join('\n'));
  console.log();
  console.log(
    `  ${pc.dim('Espresso · XCUITest · Maestro')}  ${pc.dim('·')}  ${pc.dim(version)}`,
  );
  console.log(`  ${pc.dim(context())}`);
  console.log();
  writeState(BANNER_STATE, { fullShownFor: packageJson.version });
}

export default printBanner;
