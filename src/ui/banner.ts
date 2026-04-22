import pc from 'picocolors';
import os from 'node:os';
import utils from '../utils';
import packageJson from '../../package.json';

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

function buildBigText(): string[] {
  const rows: string[] = [];
  for (let r = 0; r < LETTER_ROWS; r++) {
    const parts = WORD.split('').map((ch) => LETTERS[ch][r]);
    rows.push(parts.join(LETTER_GAP));
  }
  return rows;
}

function visibleLen(s: string): number {
  return Array.from(s).length;
}

function shouldSkipBanner(argv: string[]): boolean {
  if (!utils.isInteractive()) return true;
  for (const arg of argv) {
    if (
      arg === '--help' ||
      arg === '-h' ||
      arg === '--version' ||
      arg === '-v' ||
      arg === '-V' ||
      arg === '--quiet' ||
      arg === '-q'
    ) {
      return true;
    }
  }
  return false;
}

export function printBanner(): void {
  if (shouldSkipBanner(process.argv.slice(2))) return;

  const home = os.homedir();
  const rawCwd = process.cwd();
  const cwd = rawCwd.startsWith(home)
    ? '~' + rawCwd.slice(home.length)
    : rawCwd;
  const version = `v${packageJson.version}`;

  const bigText = buildBigText();
  const textWidth = Math.max(...bigText.map((l) => visibleLen(l)));

  const infoLines: string[] = [
    `${pc.dim('Espresso · XCUITest · Maestro')}  ${pc.dim('·')}  ${pc.dim(version)}`,
    pc.dim(cwd),
  ];

  console.log();
  for (const line of bigText) {
    console.log('  ' + pc.blue(line));
  }
  // Info lines sit flush-left under the big text, roughly aligned with its
  // left edge, so both read as one block.
  void textWidth;
  console.log();
  for (const line of infoLines) {
    console.log('  ' + line);
  }
  console.log();
}

export default printBanner;
