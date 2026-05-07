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
});
