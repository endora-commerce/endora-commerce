import { describe, expect, it } from 'vitest';
import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';

/**
 * Issue #1434 (DS-17) — the one shape a module's enum labels take.
 *
 * `t` echoes the key, so an assertion says which key a value was mapped to
 * without pinning the copy.
 */
const t = (key: string): string => `<${key}>`;

const labels = defineEnumLabels({
  'Created from admin': 'rfq.status.createdFromAdmin',
  Pending: 'rfq.status.pending',
});

describe('defineEnumLabels', () => {
  it('maps every declared value to its catalogue key', () => {
    expect(labels.label(t, 'Created from admin')).toBe('<rfq.status.createdFromAdmin>');
    expect(labels.label(t, 'Pending')).toBe('<rfq.status.pending>');
  });

  it('lists the declared values in declaration order', () => {
    expect(labels.values).toEqual(['Created from admin', 'Pending']);
  });

  it('builds select options in declaration order', () => {
    expect(labels.options(t)).toEqual([
      { value: 'Created from admin', label: '<rfq.status.createdFromAdmin>' },
      { value: 'Pending', label: '<rfq.status.pending>' },
    ]);
  });

  it('shows a value it does not know as itself rather than as a missing-key placeholder', () => {
    expect(labels.label(t, 'Archived')).toBe('Archived');
  });

  it('shows the dash for no value', () => {
    expect(labels.label(t, null)).toBe('—');
    expect(labels.label(t, undefined)).toBe('—');
    expect(labels.label(t, '')).toBe('—');
  });

  it('does not treat an inherited property name as a declared value', () => {
    expect(labels.label(t, 'toString')).toBe('toString');
    expect(labels.has('toString')).toBe(false);
    expect(labels.has('Pending')).toBe(true);
  });
});
