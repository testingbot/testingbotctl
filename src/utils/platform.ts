/**
 * Cross-platform utilities for terminal operations and signal handling
 */

const isWindows = process.platform === 'win32';

/**
 * Clear the current line in the terminal.
 * Uses ANSI escape codes on Unix/macOS, and space overwrite on Windows.
 */
export function clearLine(): void {
  if (isWindows) {
    // Windows fallback: overwrite with spaces and return to start
    // Use readline if available for better Windows support
    if (process.stdout.clearLine && process.stdout.cursorTo) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    } else {
      // Fallback: write spaces to clear typical line width
      process.stdout.write('\r' + ' '.repeat(120) + '\r');
    }
  } else {
    // Unix/macOS: ANSI escape sequence
    process.stdout.write('\r\x1b[K');
  }
}

/**
 * Setup signal handlers for graceful shutdown.
 * SIGINT (Ctrl+C) works on all platforms.
 * SIGTERM only works on Unix/macOS.
 */
export function setupSignalHandlers(handler: () => void): void {
  process.on('SIGINT', handler);

  // SIGTERM is not supported on Windows
  if (!isWindows) {
    process.on('SIGTERM', handler);
  }
}

/**
 * Remove signal handlers.
 */
export function removeSignalHandlers(handler: () => void): void {
  process.removeListener('SIGINT', handler);

  if (!isWindows) {
    process.removeListener('SIGTERM', handler);
  }
}

export default {
  isWindows,
  clearLine,
  setupSignalHandlers,
  removeSignalHandlers,
};
