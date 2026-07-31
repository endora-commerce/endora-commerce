import { describe, expect, it } from 'vitest';
import type { Config } from '@measured/puck';
import { filterConfigByContext } from './define-component.js';

const sampleConfig: Config = {
  categories: {
    layout: { title: 'Layout', components: ['Row', 'EmailText'] },
  },
  components: {
    Row: { label: 'Row', render: () => null, contexts: ['cms'] } as never,
    EmailText: { label: 'Email', render: () => null, contexts: ['email', 'newsletter'] } as never,
  },
};

describe('filterConfigByContext', () => {
  it('keeps only cms components for cms context', () => {
    const filtered = filterConfigByContext(sampleConfig, 'cms');
    expect(Object.keys(filtered.components ?? {})).toEqual(['Row']);
  });

  it('keeps email components for newsletter context', () => {
    const filtered = filterConfigByContext(sampleConfig, 'newsletter');
    expect(Object.keys(filtered.components ?? {})).toEqual(['EmailText']);
  });
});
