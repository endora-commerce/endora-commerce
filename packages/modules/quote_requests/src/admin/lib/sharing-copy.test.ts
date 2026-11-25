import { describe, expect, it } from 'vitest';
import en from '../../../i18n/en.json' with { type: 'json' };
import pl from '../../../i18n/pl.json' with { type: 'json' };

/**
 * `specs/192-quote-request-draft-share/` — the owner's 2026-11-25 naming
 * decisions (FR-009, FR-020), pinned to the shipped words in both languages.
 * The page tests resolve keys, so a reworded catalogue would pass them. The
 * core bundle's half (the create screen's buttons) is pinned in
 * `admin/test/modules/quote_requests/sharing-copy.core.test.ts`: a module
 * package's test may not read another module's files.
 */
const own = (locale: Record<string, string>) => locale;

describe('the unshared quote is named Not shared / Nieudostepniona, never Draft (FR-009)', () => {
  it('names the badge, the list filter and the header line', () => {
    expect(own(en)['share.badge.unshared']).toBe('Not shared');
    expect(own(pl)['share.badge.unshared']).toBe('Nieudostępniona');
    expect(own(en)['list.sharing.unshared']).toBe('Not shared');
    expect(own(en)['share.unshared.notice']).toBe(
      'Only your team sees this quote. The customer is not notified until shared.',
    );
    expect(own(pl)['share.unshared.notice']).toBe(
      'Ofertę widzi tylko Twój zespół. Klient dostanie powiadomienie po udostępnieniu.',
    );
  });

  it('keeps the header line and the create warning short and in the singular register', () => {
    for (const locale of [own(en), own(pl)]) {
      expect((locale['share.unshared.notice'] ?? '').length).toBeLessThanOrEqual(80);
    }
    expect(own(en)['create.warnings.notShared']).toBe('Nothing was shared: only your team can see the quote.');
    expect(own(pl)['create.warnings.notShared']).toBe('Nic nie udostępniono: ofertę widzi tylko Twój zespół.');
  });

  it('labels the list filter default All / Wszystkie', () => {
    expect(own(en)['list.sharing.all']).toBe('All');
    expect(own(pl)['list.sharing.all']).toBe('Wszystkie');
  });

  it('says Draft / Szkic in none of the sharing strings', () => {
    for (const [locale, word] of [
      [own(en), /\bdraft/i],
      [own(pl), /szkic/i],
    ] as const) {
      const offenders = Object.entries(locale).filter(
        ([key, value]) => /^(share|create|validity|list\.sharing)\./.test(key) && word.test(value),
      );
      expect(offenders).toEqual([]);
    }
  });
});

describe('the create screen buttons (FR-020)', () => {
  it('keeps Create and share', () => {
    expect(own(en)['create.share']).toBe('Create and share');
  });
});
