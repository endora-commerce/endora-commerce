import { describe, expect, it } from 'vitest';
import {
  resolveDisplayMode,
  type DisplayModeOverrideLookup,
  type SettingsDefaults,
} from '../../../src/modules/price_lists/services/display-mode-resolver.js';

const SETTINGS: SettingsDefaults = {
  defaultDisplayMode: 'gross_only',
  unauthenticatedDisplayMode: 'none',
};

const NONE: DisplayModeOverrideLookup = {
  productOverride: null,
  categoryOverride: null,
  organizationOverride: null,
};

describe('resolveDisplayMode (T021)', () => {
  it('returns settings.unauthenticatedDisplayMode for guests with no overrides', () => {
    expect(resolveDisplayMode('guest', NONE, SETTINGS)).toEqual({
      mode: 'none',
      resolvedFrom: 'settings.unauthenticated',
    });
  });

  it('returns settings.defaultDisplayMode for signed-in customers with no overrides', () => {
    expect(resolveDisplayMode('signed_in', NONE, SETTINGS)).toEqual({
      mode: 'gross_only',
      resolvedFrom: 'settings.default',
    });
  });

  it('Organization override beats Settings for signed-in customers', () => {
    expect(
      resolveDisplayMode('signed_in', { ...NONE, organizationOverride: 'both' }, SETTINGS),
    ).toEqual({ mode: 'both', resolvedFrom: 'organization' });
  });

  it('Organization override is ignored for guests (no organization for them) and Settings.unauth wins', () => {
    expect(
      resolveDisplayMode('guest', { ...NONE, organizationOverride: 'both' }, SETTINGS),
    ).toEqual({ mode: 'none', resolvedFrom: 'settings.unauthenticated' });
  });

  it('Category override beats Organization', () => {
    expect(
      resolveDisplayMode(
        'signed_in',
        { ...NONE, categoryOverride: 'net_only', organizationOverride: 'both' },
        SETTINGS,
      ),
    ).toEqual({ mode: 'net_only', resolvedFrom: 'category' });
  });

  it('Product override beats Category and Organization', () => {
    expect(
      resolveDisplayMode(
        'signed_in',
        {
          productOverride: 'none',
          categoryOverride: 'net_only',
          organizationOverride: 'both',
        },
        SETTINGS,
      ),
    ).toEqual({ mode: 'none', resolvedFrom: 'product' });
  });

  it('Product override applies to guests too (no Organization step in their chain, but Product/Category still apply)', () => {
    expect(
      resolveDisplayMode('guest', { ...NONE, productOverride: 'gross_only' }, SETTINGS),
    ).toEqual({ mode: 'gross_only', resolvedFrom: 'product' });
  });

  it('Category override applies to guests', () => {
    expect(
      resolveDisplayMode('guest', { ...NONE, categoryOverride: 'both' }, SETTINGS),
    ).toEqual({ mode: 'both', resolvedFrom: 'category' });
  });

  it('every (level × mode) combination produces a deterministic result', () => {
    const modes: Array<'gross_only' | 'net_only' | 'both' | 'none'> = [
      'gross_only',
      'net_only',
      'both',
      'none',
    ];
    for (const mode of modes) {
      // Product wins
      expect(
        resolveDisplayMode(
          'signed_in',
          { productOverride: mode, categoryOverride: 'net_only', organizationOverride: 'both' },
          SETTINGS,
        ).mode,
      ).toBe(mode);
      // Category wins (Product null)
      expect(
        resolveDisplayMode(
          'signed_in',
          { productOverride: null, categoryOverride: mode, organizationOverride: 'both' },
          SETTINGS,
        ).mode,
      ).toBe(mode);
      // Organization wins (Product+Category null)
      expect(
        resolveDisplayMode(
          'signed_in',
          { productOverride: null, categoryOverride: null, organizationOverride: mode },
          SETTINGS,
        ).mode,
      ).toBe(mode);
    }
  });
});
