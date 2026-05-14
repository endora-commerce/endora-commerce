import { describe, expect, it, vi } from 'vitest';
import { MissingKeyLogger } from '../../../src/modules/_i18n/services/missing-key-logger.js';

/**
 * T049 / FR-014 — `MissingKeyLogger` emits a structured `i18n.fallback`
 * line whenever the resolver hits a fallback. The shape stays stable
 * across callsites so operators can grep `event:"i18n.fallback"`
 * against the platform's existing log tail (research §R8).
 */
describe('MissingKeyLogger', () => {
  it('emits exactly one structured line per fallback (en target)', () => {
    const sink = { info: vi.fn() };
    const logger = new MissingKeyLogger({ logger: sink });
    logger.logFallback({
      moduleId: 'settings',
      languageCode: 'pl',
      key: 'actions.save',
      fellBackTo: 'en',
    });
    expect(sink.info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sink.info.mock.calls[0]![0] as string);
    expect(payload).toEqual({
      event: 'i18n.fallback',
      moduleId: 'settings',
      languageCode: 'pl',
      key: 'actions.save',
      fellBackTo: 'en',
    });
  });

  it('emits exactly one structured line per fallback (placeholder target)', () => {
    const sink = { info: vi.fn() };
    const logger = new MissingKeyLogger({ logger: sink });
    logger.logFallback({
      moduleId: 'settings',
      languageCode: 'pl',
      key: 'actions.save',
      fellBackTo: 'placeholder',
    });
    expect(sink.info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sink.info.mock.calls[0]![0] as string);
    expect(payload.fellBackTo).toBe('placeholder');
    expect(payload.event).toBe('i18n.fallback');
  });

  it('does not call the logger when no fallback is recorded', () => {
    const sink = { info: vi.fn() };
    new MissingKeyLogger({ logger: sink });
    expect(sink.info).not.toHaveBeenCalled();
  });

  // Feature 021 — accumulator tests.
  describe('snapshot() accumulator (feature 021)', () => {
    it('returns an empty snapshot when no fallback has occurred', () => {
      const logger = new MissingKeyLogger({ logger: { info: vi.fn() } });
      expect(logger.snapshot()).toEqual([]);
    });

    it('accumulates one entry per distinct (module, language, key) triple', () => {
      const logger = new MissingKeyLogger({ logger: { info: vi.fn() } });
      logger.logFallback({ moduleId: 'settings', languageCode: 'pl', key: 'a', fellBackTo: 'en' });
      logger.logFallback({ moduleId: 'settings', languageCode: 'pl', key: 'a', fellBackTo: 'en' });
      logger.logFallback({ moduleId: 'settings', languageCode: 'pl', key: 'b', fellBackTo: 'placeholder' });
      logger.logFallback({ moduleId: 'catalog', languageCode: 'pl', key: 'a', fellBackTo: 'en' });
      const snap = logger.snapshot();
      expect(snap).toHaveLength(3);
      const keys = snap.map((e) => `${e.moduleId}:${e.languageCode}:${e.key}`).sort();
      expect(keys).toEqual(['catalog:pl:a', 'settings:pl:a', 'settings:pl:b']);
    });

    it('pruneModule drops entries for the named module only', () => {
      const logger = new MissingKeyLogger({ logger: { info: vi.fn() } });
      logger.logFallback({ moduleId: 'settings', languageCode: 'pl', key: 'a', fellBackTo: 'en' });
      logger.logFallback({ moduleId: 'catalog', languageCode: 'pl', key: 'a', fellBackTo: 'en' });
      logger.pruneModule('settings');
      const snap = logger.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]!.moduleId).toBe('catalog');
    });

    it('snapshot returns defensive copies — mutating the result does not affect later snapshots', () => {
      const logger = new MissingKeyLogger({ logger: { info: vi.fn() } });
      logger.logFallback({ moduleId: 'settings', languageCode: 'pl', key: 'a', fellBackTo: 'en' });
      const first = logger.snapshot();
      first.pop();
      const second = logger.snapshot();
      expect(second).toHaveLength(1);
    });
  });
});
