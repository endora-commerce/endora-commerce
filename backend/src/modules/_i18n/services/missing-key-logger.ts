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

export interface MissingKeyEntry {
  moduleId: string;
  languageCode: string;
  key: string;
  fellBackTo: 'en' | 'placeholder';
}

export class MissingKeyLogger {
  private readonly logger: { info(msg: string): void };
  /**
   * Feature 021: in-process accumulator backing the coverage diagnostic.
   * Keyed by `${moduleId}:${languageCode}:${key}` so repeated resolutions
   * of the same missing entry don't inflate the count.
   */
  private readonly entries = new Map<string, MissingKeyEntry>();

  constructor(opts: MissingKeyLoggerOptions = {}) {
    // Default sink uses `console.warn` so it surfaces under the project's
    // lint policy (which restricts `console.info`). The structured payload
    // already carries `event:'i18n.fallback'`, so consumers grep on event
    // rather than log level — the level is operationally diagnostic only.
    this.logger = opts.logger ?? { info: (msg) => console.warn(msg) };
  }

  logFallback(entry: Omit<FallbackLogEntry, 'event'>): void {
    const payload: FallbackLogEntry = { event: 'i18n.fallback', ...entry };
    this.logger.info(JSON.stringify(payload));
    const k = `${entry.moduleId}:${entry.languageCode}:${entry.key}`;
    this.entries.set(k, { ...entry });
  }

  /** Coverage diagnostic — return a defensive copy of the accumulator. */
  snapshot(): MissingKeyEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Drop every accumulator entry owned by `moduleId`. Called on module
   * hard-uninstall so the diagnostic doesn't report a phantom module.
   */
  pruneModule(moduleId: string): void {
    for (const k of Array.from(this.entries.keys())) {
      if (k.startsWith(`${moduleId}:`)) this.entries.delete(k);
    }
  }
}
