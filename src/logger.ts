import pc from 'picocolors';
import tracer from 'tracer';

// When --json is active, stdout is reserved for the JSON document so every log
// line (including info) goes to stderr instead of being dropped.
let logsToStderr = false;

const logger = tracer.colorConsole({
  format: '{{timestamp}} {{message}}',
  dateformat: 'HH:MM:ss.L',
  filters: [
    {
      warn: pc.red,
      debug: pc.blue,
      error: (text: string) => pc.bold(pc.red(text)),
    },
  ],
  transport: (data) => {
    if (logsToStderr) {
      process.stderr.write(`${data.output}\n`);
    } else if (data.title === 'warn') {
      console.warn(data.output);
    } else if (data.level > 4) {
      console.error(data.output);
    } else {
      console.log(data.output);
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
