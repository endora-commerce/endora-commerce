import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';

export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  level?: string;
  /** When true (development), pretty-prints the output. */
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? process.env['LOG_LEVEL'] ?? 'info';
  const pretty = options.pretty ?? process.env['NODE_ENV'] !== 'production';

  const loggerOptions: LoggerOptions = {
    level,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.secret'],
      censor: '[REDACTED]',
    },
  };

  if (pretty) {
    return pino({
      ...loggerOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(loggerOptions);
}
