import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: true,
  // Format that works well with CloudWatch
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

export default logger; 