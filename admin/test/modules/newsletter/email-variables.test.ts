import { describe, expect, it } from 'vitest';
import { mergeEmailVariables } from '@endora-commerce/page-builder-admin/email';
import { newsletterVariables } from '../../../../packages/modules/newsletter/src/admin/email-variables';

/**
 * The `newsletter-variables` split (feature 091, P5b;
 * `admin-component-contribution.md` Z1.2). `newsletterVariables` is one
 * module's domain vocabulary and exits into `newsletter`; `mergeEmailVariables`
 * is what any e-mail builder needs and stays in
 * `@endora-commerce/page-builder-admin/email`. The module half moved again in
 * batch 11 — it is `@endora-commerce/mod-newsletter`'s `src/admin/` now — and
 * the split it proves is unchanged. The two subjects are asserted
 * from the two homes, so a merge that put them back together would fail here.
 */

describe('newsletterVariables', () => {
  it('includes base newsletter keys and custom fields', () => {
    const vars = newsletterVariables([{ key: 'city', label: 'City' }]);
    const keys = vars.map((v) => v.key);
    expect(keys).toContain('subscriber.email');
    expect(keys).toContain('unsubscribeUrl');
    expect(keys).toContain('customFields.city');
    expect(keys).toContain('branding.logoUrl');
  });
});

describe('mergeEmailVariables', () => {
  it('merges declared TE variables over branding defaults', () => {
    const vars = mergeEmailVariables([{ key: 'order.id', label: 'Order id', sampleValue: '1' }]);
    expect(vars.find((v) => v.key === 'order.id')?.label).toBe('Order id');
    expect(vars.find((v) => v.key === 'branding.logoUrl')).toBeTruthy();
  });
});
