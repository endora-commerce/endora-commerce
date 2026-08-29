import { z } from 'zod';

/**
 * Why a listing came back empty, when "empty" and "nothing exists" are not the
 * same statement (feature 087, owner decision of 2026-08-29).
 *
 * `customerFilterCond`'s `allowed-set` arm refuses **every** row of a
 * `@CustomerScoped` table that carries no `organization_id`, because no row in
 * such a table is inside a scoped actor's authority (FR-011). The refusal is
 * correct. What is not correct is the silence: the client receives `[]`, which
 * is indistinguishable from "there is nothing here", and an operator reading it
 * concludes something false about the **data** rather than something true about
 * their own reach.
 *
 * So the server says which of the two it meant. The notice is **derived** —
 * the filter records that it emitted the refusing predicate, and the host's
 * request hook puts the code on the response envelope — so no route sets a flag
 * and no screen has to be remembered. It stops being emitted, everywhere at
 * once and with no edit, on the day a table gains its column and the same arm
 * starts granting.
 *
 * It is a *notice*, never an error: the response is a 200 with a truthful body.
 */
export const SCOPE_NOTICE_CODES = {
  /**
   * The records this surface lists carry no organization at all yet, so a
   * viewer confined to a set of organizations can be shown none of them. The
   * operator-facing sentences live in the `core` i18n bundle under
   * `scopeNotice.organizationAttributionPending.*`.
   */
  ORGANIZATION_ATTRIBUTION_PENDING: 'ORGANIZATION_ATTRIBUTION_PENDING',
} as const;

export const scopeNoticeCodeSchema = z.enum(['ORGANIZATION_ATTRIBUTION_PENDING']);
export type ScopeNoticeCode = z.infer<typeof scopeNoticeCodeSchema>;

/**
 * The envelope slot the notice occupies: `meta.scopeNotice`, on any successful
 * response. `meta` is the one place the three surfaces this covers could share
 * — their bodies are `{ data, meta }`, `{ data }` and a bare page object — and
 * the key is absent rather than null when there is nothing to say.
 */
export const scopeNoticeMetaSchema = z.object({
  scopeNotice: scopeNoticeCodeSchema.optional(),
});
export type ScopeNoticeMeta = z.infer<typeof scopeNoticeMetaSchema>;

/** The envelope shape a client reads the notice out of. */
export interface ScopeNoticeEnvelope {
  readonly meta?: { readonly scopeNotice?: ScopeNoticeCode } | undefined;
}

/**
 * Read the notice off any response body, or `null` when the body carries none.
 * Written here rather than per client so that "what a notice looks like on the
 * wire" has one definition on both sides of the boundary.
 */
export function scopeNoticeOf(response: unknown): ScopeNoticeCode | null {
  if (typeof response !== 'object' || response === null) return null;
  const meta = (response as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return null;
  const code = (meta as { scopeNotice?: unknown }).scopeNotice;
  return scopeNoticeCodeSchema.safeParse(code).success ? (code as ScopeNoticeCode) : null;
}
