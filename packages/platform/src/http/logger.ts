import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';

import { prettyTransport } from './pretty-transport.js';

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

  const transport = pretty ? prettyTransport() : undefined;
  if (transport !== undefined) return pino({ ...loggerOptions, transport });
  return pino(loggerOptions);
}
