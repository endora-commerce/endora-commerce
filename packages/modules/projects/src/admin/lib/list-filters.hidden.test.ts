import { describe, expect, it } from 'vitest';
import { NO_FILTERS, hiddenFilterCount, type Filters } from './list-filters.js';

/** The count on the Projects toolbar's *More filters* disclosure (issue #1505, WORK-05). */
describe('hiddenFilterCount', () => {
  const filters = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });

  it('counts nothing for the filters the toolbar always shows', () => {
    const shown = filters({
      q: 'rack',
      state: 'open',
      organizationId: '00000000-0000-4000-8000-000000000001',
      mine: true,
      memberId: '00000000-0000-4000-8000-000000000002',
    });
    expect(hiddenFilterCount(shown, { customFields: true })).toBe(0);
  });

  it('counts the Role, the Template and the Stage name once each', () => {
    const folded = filters({ roleId: 'r', templateId: 't', stageName: 'Build' });
    expect(hiddenFilterCount(folded, { customFields: true })).toBe(3);
  });

  it('does not count a Stage name of spaces, which is not sent', () => {
    expect(hiddenFilterCount(filters({ stageName: '   ' }), { customFields: true })).toBe(0);
  });

  it('counts each custom-field filter — only for a reader who may view custom fields', () => {
    const custom = filters({ customFields: { region: { contains: 'north' }, size: { min: '3' } } });
    expect(hiddenFilterCount(custom, { customFields: true })).toBe(2);
    expect(hiddenFilterCount(custom, { customFields: false })).toBe(0);
  });
});
