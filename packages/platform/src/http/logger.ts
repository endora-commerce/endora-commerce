import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';

import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from './log-redaction.js';
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
      paths: [...LOG_REDACT_PATHS],
      censor: LOG_REDACT_CENSOR,
    },
  };

  const transport = pretty ? prettyTransport() : undefined;
  if (transport !== undefined) return pino({ ...loggerOptions, transport });
  return pino(loggerOptions);
}
