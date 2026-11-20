import pc from 'picocolors';
import tracer from 'tracer';

// When --json is active, stdout is reserved for the JSON document so every log
// line (including info) goes to stderr instead of being dropped.
let logsToStderr = false;

/**
 * Formats one log line. Progress lines (info/debug) keep a dimmed timestamp so
 * a long run can be followed in a log. Warnings and errors are messages to a
 * person, not log entries: they drop the timestamp and lead with a symbol.
 * Continuation lines (messages that start with whitespace, such as
 * "  Reason: ...") are indented under the previous line instead.
 */
export function formatLogLine(
  level: string,
  timestamp: string,
  message: string,
): string {
  // Later lines of a multi-line warning or error line up under its text.
  if ((level === 'error' || level === 'warn') && message.includes('\n')) {
    const [first, ...rest] = message.split('\n');
    return [
      formatLogLine(level, timestamp, first),
      ...rest.map((line) => formatLogLine(level, timestamp, `  ${line}`)),
    ].join('\n');
  }
  const continuation = /^\s/.test(message);
  switch (level) {
    case 'error':
      return continuation ? pc.red(message) : pc.bold(pc.red(`✘ ${message}`));
    case 'warn':
      return continuation ? pc.yellow(message) : pc.yellow(`⚠ ${message}`);
    case 'debug':
      return `${pc.dim(timestamp)} ${pc.blue(message)}`;
    default:
      return `${pc.dim(timestamp)} ${message}`;
  }
}

const logger = tracer.console({
  format: '{{message}}',
  dateformat: 'HH:MM:ss.L',
  transport: (data) => {
    const line = formatLogLine(data.title, data.timestamp, data.message);
    if (logsToStderr) {
      process.stderr.write(`${line}\n`);
    } else if (data.title === 'warn') {
      console.warn(line);
    } else if (data.level > 4) {
      console.error(line);
    } else {
      console.log(line);
    }
  },
});

tracer.setLevel('info');

export function enableDebugLogging(): void {
  tracer.setLevel('debug');
}

/** Routes all log output to stderr so stdout can carry machine-readable JSON. */
export function redirectLogsToStderr(): void {
  logsToStderr = true;
}

export default logger;
