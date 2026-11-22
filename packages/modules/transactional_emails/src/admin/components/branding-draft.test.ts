import { describe, expect, it } from 'vitest';

import { brandingPatch, brandingWrite, draftOfBranding, inheritField, overridden, withEdit } from './branding-draft.js';

/**
 * Issue #1466 — the branding screen's Save sends only what changed, so a sales
 * channel keeps inheriting every value it did not override.
 */
describe('brandingPatch', () => {
  const loaded = { logoAssetId: 'asset-1', accentColor: '#1f2937', inherit: [] };

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
    expect(brandingPatch(loaded, { logoAssetId: 'asset-2', accentColor: '#000000', inherit: [] })).toEqual({
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
    ).toEqual({ logoAssetId: 'a', accentColor: '#123456', inherit: [] });
  });
});

/**
 * Issue #1588 — "Use all-channels value" is staged, like every other edit on the
 * screen, and the one Save removes the channel's own value instead of writing
 * the all-channels value back as a copy (which would stop the channel following
 * a later all-channels change).
 */
describe('inheriting the all-channels value', () => {
  const allChannels = { logoAssetId: 'asset-global', accentColor: '#0a7e5c', inherit: [] };
  const channel = { logoAssetId: 'asset-global', accentColor: '#c2410c', inherit: [] };

  it('says which fields the channel sets differently from all channels', () => {
    expect(overridden(channel, allChannels, 'accentColor')).toBe(true);
    expect(overridden(channel, allChannels, 'logoAssetId')).toBe(false);
    expect(overridden({ ...channel, accentColor: '#0A7E5C' }, allChannels, 'accentColor')).toBe(false);
  });

  it('shows the all-channels value and marks the field to inherit', () => {
    expect(inheritField(channel, allChannels, 'accentColor')).toEqual({
      logoAssetId: 'asset-global',
      accentColor: '#0a7e5c',
      inherit: ['accentColor'],
    });
  });

  it('turns an inherited field into a reset, not a write', () => {
    const draft = inheritField(channel, allChannels, 'accentColor');
    expect(brandingWrite(channel, draft)).toEqual({ put: null, reset: ['accentColor'] });
  });

  it('keeps writing the other changed field beside the reset', () => {
    const draft = { ...inheritField(channel, allChannels, 'accentColor'), logoAssetId: 'asset-2' };
    expect(brandingWrite(channel, draft)).toEqual({ put: { logoAssetId: 'asset-2' }, reset: ['accentColor'] });
  });

  it('is null when nothing changed', () => {
    expect(brandingWrite(channel, channel)).toBeNull();
  });

  it('an edit after "Use all-channels value" makes the field an override again', () => {
    const draft = withEdit(inheritField(channel, allChannels, 'accentColor'), { accentColor: '#000000' });
    expect(draft.inherit).toEqual([]);
    expect(brandingWrite(channel, draft)).toEqual({ put: { accentColor: '#000000' }, reset: [] });
  });
});
