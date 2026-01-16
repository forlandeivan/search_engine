import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Create base Pino logger
export const logger = pino({
  level: logLevel,
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      }
    : {
        formatters: {
          level: (label) => ({ level: label }),
          bindings: () => ({}),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

// Create child loggers for different components
export const createLogger = (component: string) => logger.child({ component });

// Backward-compatible log function
export function log(message: string, source = 'express') {
  logger.info({ source }, message);
}

export type Logger = typeof logger;
export type ChildLogger = ReturnType<typeof createLogger>;
