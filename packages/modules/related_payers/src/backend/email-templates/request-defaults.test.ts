import { describe, expect, it } from 'vitest';
import { RELATED_PAYER_LINK_REVOKED_DEFAULT } from './request-defaults.js';

/**
 * `specs/182-related-payers/` — owner, 2026-11-19: "revoke" has one Polish verb, in the
 * e-mails as on every screen (admin and storefront), so the revocation e-mail uses it too.
 */
describe('related_payer_link_revoked defaults', () => {
  it('uses the one Polish word for "revoked" the screens use', () => {
    const polish = JSON.stringify(
      (RELATED_PAYER_LINK_REVOKED_DEFAULT.defaultContent.languages as Record<string, unknown>)['pl-PL'],
    );
    expect(polish).toContain('Powiązanie z płatnikiem zostało odwołane');
    expect(polish).not.toMatch(/cofni/i);
  });
});
