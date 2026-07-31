import { describe, expect, it } from 'vitest';
import { mergeEmailVariables, newsletterVariables } from '@/modules/_shared/email-builder/newsletter-variables';

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
