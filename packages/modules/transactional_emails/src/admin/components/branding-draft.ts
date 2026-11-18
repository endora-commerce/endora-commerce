import type { EmailBranding, PutEmailBrandingRequest } from '@endora-commerce/contracts';

/** What the branding screen edits: the two values an operator sets by hand. */
export interface BrandingDraft {
  readonly logoAssetId: string;
  readonly accentColor: string;
}

export function draftOfBranding(branding: EmailBranding): BrandingDraft {
  return { logoAssetId: branding.logoAssetId, accentColor: branding.accentColor };
}

/**
 * The write a Save sends: **only the fields the operator changed** (issue #1466).
 *
 * A sales channel's read answers with the effective value — its own override, or
 * the all-channels value it inherits. Sending both fields back on every Save
 * would turn an inherited value into a channel override the operator never
 * chose, and a later change to the all-channels logo would silently stop
 * reaching that channel. Sending the difference keeps inheritance intact.
 *
 * Returns `null` when nothing changed, so the screen has nothing to save.
 */
export function brandingPatch(loaded: BrandingDraft, draft: BrandingDraft): PutEmailBrandingRequest | null {
  const patch: { logoAssetId?: string; accentColor?: string } = {};
  if (draft.logoAssetId !== loaded.logoAssetId) patch.logoAssetId = draft.logoAssetId;
  if (draft.accentColor.toLowerCase() !== loaded.accentColor.toLowerCase()) patch.accentColor = draft.accentColor;
  return Object.keys(patch).length === 0 ? null : patch;
}
