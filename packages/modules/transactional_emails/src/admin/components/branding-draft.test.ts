import { describe, expect, it } from 'vitest';

import { brandingPatch, draftOfBranding } from './branding-draft.js';

/**
 * Issue #1466 — the branding screen's Save sends only what changed, so a sales
 * channel keeps inheriting every value it did not override.
 */
describe('brandingPatch', () => {
  const loaded = { logoAssetId: 'asset-1', accentColor: '#1f2937' };

  it('is null when nothing changed', () => {
    expect(brandingPatch(loaded, { ...loaded })).toBeNull();
  });

  it('treats a hex differing only in case as unchanged', () => {
    expect(brandingPatch(loaded, { ...loaded, accentColor: '#1F2937' })).toBeNull();
  });

  it('sends the accent alone when only the accent changed', () => {
    expect(brandingPatch(loaded, { ...loaded, accentColor: '#c2410c' })).toEqual({ accentColor: '#c2410c' });
  });

  it('sends the logo alone when only the logo changed, including clearing it', () => {
    expect(brandingPatch(loaded, { ...loaded, logoAssetId: 'asset-2' })).toEqual({ logoAssetId: 'asset-2' });
    expect(brandingPatch(loaded, { ...loaded, logoAssetId: '' })).toEqual({ logoAssetId: '' });
  });

  it('sends both when both changed', () => {
    expect(brandingPatch(loaded, { logoAssetId: 'asset-2', accentColor: '#000000' })).toEqual({
      logoAssetId: 'asset-2',
      accentColor: '#000000',
    });
  });
});

describe('draftOfBranding', () => {
  it('keeps the two operator-set values of a resolved branding', () => {
    expect(
      draftOfBranding({
        salesChannelId: null,
        logoAssetId: 'a',
        logoUrl: 'https://cdn.example/a.png',
        accentColor: '#123456',
        headerBlockCode: 'default_email_header',
        footerBlockCode: 'default_email_footer',
        source: 'global',
      }),
    ).toEqual({ logoAssetId: 'a', accentColor: '#123456' });
  });
});
