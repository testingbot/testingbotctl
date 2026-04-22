import pc from 'picocolors';
import utils from '../utils';
import platform from '../utils/platform';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TICK_MS = 80;

/**
 * Single-line animated spinner for long-running status updates. Writes
 * `\r{frame} {message}` on each tick to rewrite the current line in place.
 *
 * In non-interactive environments (no TTY, or CI=1) the spinner is a no-op —
 * providers already `console.log` status transitions, so CI logs stay readable.
 */
export default class Spinner {
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private message = '';
  private active = false;
  private readonly interactive: boolean;

  public constructor() {
    this.interactive = utils.isInteractive();
  }

  /** Starts (or refreshes) the spinner with the given message. */
  public start(message: string): void {
    this.message = message;
    if (!this.interactive) return;
    if (this.active) {
      this.render();
      return;
    }
    this.active = true;
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % BRAILLE_FRAMES.length;
      this.render();
    }, TICK_MS);
    // Don't keep the event loop alive on this timer.
    this.timer.unref?.();
  }

  /** Updates the visible message; starts the spinner if it wasn't running. */
  public setMessage(message: string): void {
    if (!this.active) {
      this.start(message);
      return;
    }
    if (this.message === message) return;
    this.message = message;
    this.render();
  }

  /**
   * Clears the current spinner line without stopping the timer. Call before
   * printing unrelated output that shouldn't be overwritten by the next tick.
   */
  public clearLine(): void {
    if (!this.interactive || !this.active) return;
    platform.clearLine();
  }

  /**
   * Stops the animation, clears the line, and optionally prints a final
   * non-animated line in its place.
   */
  public stop(finalLine?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.active && this.interactive) {
      platform.clearLine();
    }
    this.active = false;
    if (finalLine !== undefined) {
      console.log(finalLine);
    }
  }

  public isActive(): boolean {
    return this.active;
  }

  private render(): void {
    if (!this.interactive) return;
    const frame = pc.cyan(BRAILLE_FRAMES[this.frame]);
    process.stdout.write(`\r${frame} ${this.message}`);
  }
}
