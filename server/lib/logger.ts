import pino from 'pino';
import { resolve } from 'path';
import { createWriteStream } from 'fs';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Create file stream for dev.log
const devLogStream = isDevelopment
  ? pino.multistream([
      { stream: pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        })
      },
      { stream: createWriteStream(resolve(process.cwd(), 'dev.log'), { flags: 'a' }) },
    ])
  : undefined;

// Create base Pino logger
export const logger = pino({
  level: logLevel,
  ...(isDevelopment && devLogStream
    ? {}
    : {
        formatters: {
          level: (label) => ({ level: label }),
          bindings: () => ({}),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
}, devLogStream);

// Create child loggers for different components
export const createLogger = (component: string) => logger.child({ component });

// Backward-compatible log function
export function log(message: string, source = 'express') {
  logger.info({ source }, message);
}

export type Logger = typeof logger;
export type ChildLogger = ReturnType<typeof createLogger>;
