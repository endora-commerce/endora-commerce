// Minimal logger stub — replaced with the full pino configuration + requestId bindings
// in Phase 2 task T020.

export interface Logger {
  info: (obj: Record<string, unknown> | string, msg?: string) => void;
  warn: (obj: Record<string, unknown> | string, msg?: string) => void;
  error: (obj: Record<string, unknown> | string, msg?: string) => void;
}

export function createLogger(): Logger {
  const log = (level: 'info' | 'warn' | 'error') =>
    (obj: Record<string, unknown> | string, msg?: string): void => {
      const payload = typeof obj === 'string' ? { msg: obj } : { ...obj, ...(msg ? { msg } : {}) };
      const line = JSON.stringify({ level, time: new Date().toISOString(), ...payload });
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.warn(line);
      }
    };
  return { info: log('info'), warn: log('warn'), error: log('error') };
}
