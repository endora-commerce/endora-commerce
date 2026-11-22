import type { EmailBranding, EmailBrandingField, PutEmailBrandingRequest } from '@endora-commerce/contracts';

/** The two values an operator sets by hand on the branding screen. */
export type BrandingDraftField = Extract<EmailBrandingField, 'logoAssetId' | 'accentColor'>;

/** What the branding screen edits. */
export interface BrandingDraft {
  readonly logoAssetId: string;
  readonly accentColor: string;
  /**
   * Fields the operator chose to take from all channels again ("Use
   * all-channels value", issue #1588). Save removes the channel's own value for
   * these rather than writing the value shown.
   */
  readonly inherit: readonly BrandingDraftField[];
}

export function draftOfBranding(branding: EmailBranding): BrandingDraft {
  return { logoAssetId: branding.logoAssetId, accentColor: branding.accentColor, inherit: [] };
}

function same(field: BrandingDraftField, a: string, b: string): boolean {
  return field === 'accentColor' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Whether the channel's value of `field` differs from the all-channels value —
 * the only case in which going back to it changes what the channel sends.
 */
export function overridden(channel: BrandingDraft, allChannels: BrandingDraft, field: BrandingDraftField): boolean {
  return !same(field, channel[field], allChannels[field]);
}

/** Stage "Use all-channels value": show the inherited value and mark the field. */
export function inheritField(
  draft: BrandingDraft,
  allChannels: BrandingDraft,
  field: BrandingDraftField,
): BrandingDraft {
  return {
    ...draft,
    [field]: allChannels[field],
    inherit: draft.inherit.includes(field) ? draft.inherit : [...draft.inherit, field],
  };
}

/** An edit by hand: the edited field is the channel's own value again. */
export function withEdit(draft: BrandingDraft, change: Partial<Pick<BrandingDraft, BrandingDraftField>>): BrandingDraft {
  return { ...draft, ...change, inherit: draft.inherit.filter((field) => !(field in change)) };
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
 * Fields marked to inherit are left out: they are reset, not written.
 *
 * Returns `null` when nothing changed, so the screen has nothing to save.
 */
export function brandingPatch(loaded: BrandingDraft, draft: BrandingDraft): PutEmailBrandingRequest | null {
  const patch: { logoAssetId?: string; accentColor?: string } = {};
  for (const field of ['logoAssetId', 'accentColor'] as const) {
    if (draft.inherit.includes(field)) continue;
    if (!same(field, draft[field], loaded[field])) patch[field] = draft[field];
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Everything one Save does: the values to write and the fields to reset (issue #1588). */
export interface BrandingWrite {
  readonly put: PutEmailBrandingRequest | null;
  readonly reset: readonly BrandingDraftField[];
}

export function brandingWrite(loaded: BrandingDraft, draft: BrandingDraft): BrandingWrite | null {
  const put = brandingPatch(loaded, draft);
  if (put === null && draft.inherit.length === 0) return null;
  return { put, reset: draft.inherit };
}
