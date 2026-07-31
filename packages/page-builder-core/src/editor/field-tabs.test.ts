import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  componentHasDataFields,
  componentHasItemsFields,
  componentHasResponsiveFields,
  fieldTabForName,
} from '../editor/field-tabs.js';
import { PB_DATA_METADATA, PB_ITEMS_METADATA, PB_RESPONSIVE_METADATA } from '../types/responsive.js';

describe('fieldTabForName', () => {
  it('routes editor chrome to general', () => {
    expect(fieldTabForName('editorName', { type: 'text', label: 'Name' })).toBe('general');
    expect(
      fieldTabForName('hideOn', { type: 'custom', label: 'Hide on', render: () => createElement('span') }),
    ).toBe('general');
  });

  it('routes responsive metadata fields to responsive tab', () => {
    expect(fieldTabForName('gap', { type: 'number', label: 'Gap', metadata: PB_RESPONSIVE_METADATA })).toBe('responsive');
  });

  it('routes data metadata fields to data tab', () => {
    expect(
      fieldTabForName('source', {
        type: 'select',
        label: 'Source',
        options: [{ label: 'Manual', value: 'manual' }],
        metadata: PB_DATA_METADATA,
      }),
    ).toBe('data');
  });

  it('detects responsive fields on a component', () => {
    expect(
      componentHasResponsiveFields({
        background: { type: 'text', label: 'Background' },
        gap: { type: 'number', label: 'Gap', metadata: PB_RESPONSIVE_METADATA },
      }),
    ).toBe(true);
  });

  it('routes items metadata fields to items tab', () => {
    expect(
      fieldTabForName('items', {
        type: 'array',
        label: 'Slides',
        arrayFields: {},
        metadata: PB_ITEMS_METADATA,
      }),
    ).toBe('items');
  });

  it('detects items fields on a component', () => {
    expect(
      componentHasItemsFields({
        items: {
          type: 'array',
          label: 'Slides',
          arrayFields: {},
          metadata: PB_ITEMS_METADATA,
        },
      }),
    ).toBe(true);
  });

  it('detects data fields on a component', () => {
    expect(
      componentHasDataFields({
        source: {
          type: 'select',
          label: 'Source',
          options: [{ label: 'Manual', value: 'manual' }],
          metadata: PB_DATA_METADATA,
        },
        columns: { type: 'number', label: 'Columns' },
      }),
    ).toBe(true);
  });
});
