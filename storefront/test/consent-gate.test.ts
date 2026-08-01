import { describe, expect, it } from 'vitest';
import { shouldPromptConsent } from '../lib/analytics/consent-gate';

/**
 * Feature 066 — FR-015. The cookie banner belongs to the storefront, not to any
 * one tracking module, so it must prompt whenever *any* enabled integration on
 * the channel requires consent.
 */
describe('shouldPromptConsent', () => {
  const off = { enabled: false, requireConsent: true };
  const onNoConsent = { enabled: true, requireConsent: false };
  const onWithConsent = { enabled: true, requireConsent: true };

  it('does not prompt when no platform is configured', () => {
    expect(shouldPromptConsent([])).toBe(false);
  });

  it('does not prompt for a disabled platform, however it is configured', () => {
    expect(shouldPromptConsent([off, off])).toBe(false);
  });

  it('does not prompt when every enabled platform runs without consent', () => {
    expect(shouldPromptConsent([onNoConsent, off])).toBe(false);
  });

  it('prompts when the single enabled platform requires consent', () => {
    expect(shouldPromptConsent([onWithConsent])).toBe(true);
  });

  it('prompts when at least one of several enabled platforms requires consent', () => {
    expect(shouldPromptConsent([onNoConsent, onWithConsent, off])).toBe(true);
  });

  it('prompts for a GTM-only channel with Google Analytics off (the regression)', () => {
    // Before feature 066 the banner was gated on the GA config alone, so this
    // channel never prompted and consent stayed denied forever.
    const ga = { enabled: false, requireConsent: true };
    const linkedIn = { enabled: false, requireConsent: true };
    const meta = { enabled: false, requireConsent: true };
    const gtm = { enabled: true, requireConsent: true };
    expect(shouldPromptConsent([ga, linkedIn, meta, gtm])).toBe(true);
  });
});
