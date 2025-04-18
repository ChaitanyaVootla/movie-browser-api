/**
 * Simple logger utility for the application
 */

import pino from 'pino';
import pinoLoki from 'pino-loki';

/**
 * Configure logger with support for both console output and Loki
 */
const createLogger = () => {
  // Basic logger configuration
  const loggerConfig = {
    level: 'trace',
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // Development-specific configuration for pretty printing
  const devConfig = {
    ...loggerConfig,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
      },
    },
  };

  // Production configuration with Loki support
  const prodConfig = () => {
    try {
      const lokiTransport = pinoLoki({
        batching: true,
        interval: 1, // seconds
        host: 'http://localhost:3100',
        replaceTimestamp: true,
        labels: {
          app: 'movie-browser-api',
          env: process.env.NODE_ENV || 'development'
        }
      });
      
      return pino(loggerConfig, pino.multistream([
        { stream: process.stdout },
        { stream: lokiTransport }
      ]));
    } catch (error) {
      console.error('Failed to initialize Loki logger:', error);
      return pino(loggerConfig);
    }
  };

  // Use development config if in development, otherwise use production config
  return process.env.NODE_ENV === 'production' ? prodConfig() : pino(devConfig);
};

const logger = createLogger();

// Add a simple test log on initialization
logger.info('Logger initialized');

export default logger;
