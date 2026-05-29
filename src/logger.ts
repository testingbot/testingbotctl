import pc from 'picocolors';
import tracer from 'tracer';

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
});

tracer.setLevel('info');

export function enableDebugLogging(): void {
  tracer.setLevel('debug');
}

export default logger;
