import { describe, expect, it } from 'vitest';
import { socialItemSummary } from './social-networks.js';

describe('socialItemSummary', () => {
  it('uses the network name in the list label', () => {
    expect(socialItemSummary({ network: 'facebook' }, 0)).toBe('Facebook (#1)');
    expect(socialItemSummary({ network: 'linkedin', label: 'Company' })).toBe('LinkedIn — Company');
  });
});
