import { describe, expect, it } from 'vitest';
import { readReturnTo, withReturnTo } from '@endora-commerce/admin-kit/lib';

/**
 * `?returnTo=` — the one way a screen opened from elsewhere learns where its
 * Back leads (`specs/158-crm-opportunity-inline-editing/`, FR-020). The value
 * is a path of this application only: never a scheme, a host or `//`.
 */
describe('readReturnTo', () => {
  it('reads a path of this application, query and all', () => {
    expect(readReturnTo(new URLSearchParams('returnTo=%2Fcrm%2Fopportunities%2Fabc%3Ftab%3Dlinks'))).toBe(
      '/crm/opportunities/abc?tab=links',
    );
  });

  it.each(['https://evil.example/', '//evil.example/', '/\\evil.example', 'javascript:alert(1)', 'crm', ''])(
    'refuses %j',
    (value) => {
      expect(readReturnTo(new URLSearchParams({ returnTo: value }))).toBeNull();
    },
  );

  it('is null when the address names none', () => {
    expect(readReturnTo(new URLSearchParams('tab=x'))).toBeNull();
  });

  it('reads another parameter by the same rule when named (issue #859, `/login?next=`)', () => {
    expect(readReturnTo(new URLSearchParams('next=%2Forders%3Fstatus%3Dopen'), 'next')).toBe('/orders?status=open');
    expect(readReturnTo(new URLSearchParams({ next: '//evil.example/' }), 'next')).toBeNull();
    expect(readReturnTo(new URLSearchParams({ returnTo: '/orders' }), 'next')).toBeNull();
  });
});

describe('withReturnTo', () => {
  it('adds the return address to a target, keeping the query it has', () => {
    expect(withReturnTo('/orders/1', '/crm/opportunities/a?tab=links')).toBe(
      '/orders/1?returnTo=%2Fcrm%2Fopportunities%2Fa%3Ftab%3Dlinks',
    );
    expect(withReturnTo('/orders/1?x=1#top', '/crm/a')).toBe('/orders/1?x=1&returnTo=%2Fcrm%2Fa#top');
  });

  it('leaves the target alone for a return address it would refuse to read back', () => {
    expect(withReturnTo('/orders/1', 'https://evil.example/')).toBe('/orders/1');
  });
});
