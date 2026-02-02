import pino from 'pino';
import { resolve } from 'path';
import { createWriteStream } from 'fs';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// dev.log:
// - In development we want maximum observability by default (for debugging pipelines like ASR).
// - You can disable file logging by setting DEV_LOG=0.
// - In production file logging remains opt-in (DEV_LOG=1).
const enableDevLogFile = isDevelopment
  ? process.env.DEV_LOG !== '0'
  : process.env.DEV_LOG === '1';

const prettyTransport = isDevelopment
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    })
  : undefined;

const destination = isDevelopment
  ? enableDevLogFile
    ? pino.multistream([
        { stream: prettyTransport! },
        { stream: createWriteStream(resolve(process.cwd(), 'dev.log'), { flags: 'a' }) },
      ])
    : prettyTransport
  : undefined;

// Create base Pino logger
export const logger = pino({
  level: logLevel,
  ...(isDevelopment && destination
    ? {}
    : {
        formatters: {
          level: (label) => ({ level: label }),
          bindings: () => ({}),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
}, destination);

// Create child loggers for different components
export const createLogger = (component: string) => logger.child({ component });

// Backward-compatible log function
export function log(message: string, source = 'express') {
  logger.info({ source }, message);
}

export type Logger = typeof logger;
export type ChildLogger = ReturnType<typeof createLogger>;
