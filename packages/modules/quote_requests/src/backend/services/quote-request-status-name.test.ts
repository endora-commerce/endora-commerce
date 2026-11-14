import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { rfqStatusSchema } from '@endora-commerce/contracts';
import en from '../../../i18n/en.json' with { type: 'json' };
import pl from '../../../i18n/pl.json' with { type: 'json' };
import { QuoteRequestReadService } from './quote-request-read-port.js';
import { quoteRequestStatusName } from './quote-request-status-name.js';

/**
 * Issue #455 — `quote_requests` names its own statuses for another module, in
 * the language that module asks for, through `QuoteRequestReadPort.statusName`:
 * a consumer never keeps a copy of the wording, and never shows the stored
 * code.
 */
function bundleTranslate(key: string, language: 'en' | 'pl'): Promise<string> {
  const value = (language === 'pl' ? pl : en)[key as keyof typeof en];
  return Promise.resolve(typeof value === 'string' ? value : key);
}

describe('quote request status names (issue #455)', () => {
  it('names every status of the closed set in both shipped languages', async () => {
    for (const status of rfqStatusSchema.options) {
      for (const language of ['en', 'pl'] as const) {
        const name = await quoteRequestStatusName(bundleTranslate, status, language);
        expect(name, `${status} in ${language}`).not.toMatch(/^adminSearch\./);
        expect(name.length).toBeGreaterThan(0);
      }
    }
    expect(await quoteRequestStatusName(bundleTranslate, 'Created from admin', 'pl')).toBe('Utworzone przez admina');
    expect(await quoteRequestStatusName(bundleTranslate, 'Pending', 'pl')).toBe('Oczekujące');
  });

  it('answers a code outside the set as it is', async () => {
    const translate = vi.fn(bundleTranslate);
    expect(await quoteRequestStatusName(translate, 'Archived', 'pl')).toBe('Archived');
    expect(translate).not.toHaveBeenCalled();
  });

  it('is what the read port answers', async () => {
    const port = new QuoteRequestReadService((() => ({})) as unknown as () => EntityManager, bundleTranslate);
    expect(await port.statusName('Pending', 'pl')).toBe('Oczekujące');
    expect(await port.statusName('Pending', 'en')).toBe('Pending');
  });
});
