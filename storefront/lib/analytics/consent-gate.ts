/**
 * Whether the cookie-consent prompt is owed to this visitor (feature 066,
 * FR-015).
 *
 * The prompt belongs to the storefront, not to any one tracking module: it is
 * shown when *any* enabled integration on the channel requires consent. Before
 * this existed the banner was gated on the Google Analytics config alone, so a
 * channel running only Google Tag Manager (or only Meta, or only LinkedIn)
 * never prompted and consent stayed denied forever.
 */
export interface ConsentRequiringPlatform {
  enabled: boolean;
  requireConsent: boolean;
}

export function shouldPromptConsent(
  platforms: ReadonlyArray<ConsentRequiringPlatform>,
): boolean {
  return platforms.some((p) => p.enabled && p.requireConsent);
}
