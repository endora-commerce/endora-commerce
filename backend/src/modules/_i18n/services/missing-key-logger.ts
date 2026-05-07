import type { ModuleLifecycleLogger } from '@b2b/contracts';

/**
 * Diagnostic surface for the resolver's fallback path — feature 019 /
 * spec FR-014, research §R8.
 *
 * Every time the resolver falls back from the user's preferred language
 * to English, or from English to the literal `${scope}.${key}` placeholder,
 * a structured log line is emitted so the gap is observable without
 * changing user-facing behaviour.
 *
 * Shape stays stable across callsites — operators run
 * `grep '"event":"i18n.fallback"'` against the platform's existing log
 * tail. The shape is exercised by `test/unit/_i18n/missing-key-logger.unit.test.ts`.
 */

export interface FallbackLogEntry {
  event: 'i18n.fallback';
  moduleId: string;
  languageCode: string;
  key: string;
  fellBackTo: 'en' | 'placeholder';
}

export interface MissingKeyLoggerOptions {
  /** Optional logger override; falls back to the project's standard console-style sink. */
  logger?: Pick<ModuleLifecycleLogger, 'info'> & { info(msg: string): void };
}

export class MissingKeyLogger {
  private readonly logger: { info(msg: string): void };

  constructor(opts: MissingKeyLoggerOptions = {}) {
    this.logger = opts.logger ?? { info: (msg) => console.info(msg) };
  }

  logFallback(entry: Omit<FallbackLogEntry, 'event'>): void {
    const payload: FallbackLogEntry = { event: 'i18n.fallback', ...entry };
    this.logger.info(JSON.stringify(payload));
  }
}
