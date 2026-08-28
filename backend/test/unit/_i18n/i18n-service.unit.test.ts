import { describe, expect, it, vi } from 'vitest';
import { I18nService } from '@endora-commerce/mod-i18n/backend';
import { MissingKeyLogger } from '@endora-commerce/mod-i18n/backend';

/**
 * T048 / FR-013 — backend resolver fallback chain.
 *
 * The translate() path is unit-tested by stubbing
 * `getMergedBundleForLanguage` so we don't need a real EM/Knex. The
 * stubbing is via Object.defineProperty on the prototype because
 * the method is normally bound via the class instance.
 */
describe('I18nService.translate', () => {
  function makeService(opts: {
    en?: Record<string, Record<string, string>>;
    pl?: Record<string, Record<string, string>>;
    enVersion?: number;
    plVersion?: number;
  }): { svc: I18nService; logger: MissingKeyLogger; logSink: ReturnType<typeof vi.fn> } {
    const logSink = vi.fn();
    const logger = new MissingKeyLogger({ logger: { info: logSink } });
    const svc = new I18nService({
      em: () => {
        throw new Error('EM should not be called when getMerged is stubbed');
      },
      missingKeyLogger: logger,
    });
    // Replace getMergedBundleForLanguage with a deterministic stub.
    (svc as unknown as {
      getMergedBundleForLanguage: I18nService['getMergedBundleForLanguage'];
    }).getMergedBundleForLanguage = (async (language) => {
      if (language === 'en') {
        return { version: opts.enVersion ?? 1, bundles: opts.en ?? {} };
      }
      return { version: opts.plVersion ?? 1, bundles: opts.pl ?? {} };
    }) as I18nService['getMergedBundleForLanguage'];
    return { svc, logger, logSink };
  }

  it('returns the requested-language value when present', async () => {
    const { svc, logSink } = makeService({
      pl: { settings: { 'actions.save': 'Zapisz' } },
      en: { settings: { 'actions.save': 'Save' } },
    });
    expect(await svc.translate('settings', 'actions.save', 'pl')).toBe('Zapisz');
    expect(logSink).not.toHaveBeenCalled();
  });

  it('falls back to English when missing in pl, and emits one log line', async () => {
    const { svc, logSink } = makeService({
      pl: {},
      en: { settings: { 'actions.save': 'Save' } },
    });
    expect(await svc.translate('settings', 'actions.save', 'pl')).toBe('Save');
    expect(logSink).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSink.mock.calls[0]![0] as string);
    expect(payload.fellBackTo).toBe('en');
    expect(payload.languageCode).toBe('pl');
    expect(payload.key).toBe('actions.save');
  });

  it('returns the placeholder when both languages are missing, and emits one log line', async () => {
    const { svc, logSink } = makeService({ pl: {}, en: {} });
    expect(await svc.translate('settings', 'actions.unknown', 'pl')).toBe(
      'settings.actions.unknown',
    );
    expect(logSink).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSink.mock.calls[0]![0] as string);
    expect(payload.fellBackTo).toBe('placeholder');
  });

  it('does not consult EN when language is already EN — emits placeholder log line directly', async () => {
    const { svc, logSink } = makeService({ en: {} });
    expect(await svc.translate('settings', 'actions.unknown', 'en')).toBe(
      'settings.actions.unknown',
    );
    expect(logSink).toHaveBeenCalledTimes(1);
  });

  it('interpolates {name} placeholders from the params map', async () => {
    const { svc } = makeService({
      pl: { orders: { 'toast.created': 'Zamówienie {id} utworzone' } },
    });
    expect(
      await svc.translate('orders', 'toast.created', 'pl', { id: '42' }),
    ).toBe('Zamówienie 42 utworzone');
  });

  it('leaves unfilled placeholders visible (no silent elision)', async () => {
    const { svc } = makeService({
      pl: { orders: { 'toast.created': 'Zamówienie {id} utworzone' } },
    });
    expect(await svc.translate('orders', 'toast.created', 'pl')).toBe(
      'Zamówienie {id} utworzone',
    );
  });

  it('returns the placeholder when the scope itself is absent from both bundles', async () => {
    const { svc } = makeService({
      pl: { other: { 'k.v': 'pl-other' } },
      en: { other: { 'k.v': 'en-other' } },
    });
    expect(await svc.translate('absent_module', 'whatever.key', 'pl')).toBe(
      'absent_module.whatever.key',
    );
  });
});
