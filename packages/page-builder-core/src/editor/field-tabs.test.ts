import { describe, expect, it } from 'vitest';
import { fieldTabForName, componentHasResponsiveFields } from '../editor/field-tabs.js';
import { PB_RESPONSIVE_METADATA } from '../types/responsive.js';

describe('fieldTabForName', () => {
  it('routes editor chrome to general', () => {
    expect(fieldTabForName('editorName', { type: 'text', label: 'Name' })).toBe('general');
    expect(fieldTabForName('hideOn', { type: 'custom', label: 'Hide on', render: () => null })).toBe('general');
  });

  it('routes responsive metadata fields to responsive tab', () => {
    expect(fieldTabForName('gap', { type: 'number', label: 'Gap', metadata: PB_RESPONSIVE_METADATA })).toBe('responsive');
  });

  it('detects responsive fields on a component', () => {
    expect(
      componentHasResponsiveFields({
        background: { type: 'text', label: 'Background' },
        gap: { type: 'number', label: 'Gap', metadata: PB_RESPONSIVE_METADATA },
      }),
    ).toBe(true);
  });
});
