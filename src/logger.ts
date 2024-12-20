import colors from 'colors';
import tracer from 'tracer';

const logger = tracer.colorConsole({
  level: 'info',
  format: '{{timestamp}} {{title}}: {{message}}',
  dateformat: 'HH:MM:ss.L',
  filters: [
    {
      warn: colors.red,
      debug: colors.blue,
      error: [colors.red, colors.bold],
    },
  ],
});

export default logger;
