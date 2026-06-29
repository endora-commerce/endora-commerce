// Email content envelope (feature 047) — mirrors the CMS envelope shape so the
// admin Puck editor produces the same wire format, but is owned here so the
// backend never imports CMS internals (Constitution Principle I).

export const CURRENT_EMAIL_SCHEMA_VERSION = 1 as const;

/**
 * A single Puck data tree as produced by the email editor for one language.
 * Treated as opaque at this layer — Puck's actual type lives in
 * `@measured/puck`; we round-trip the shape verbatim through the envelope.
 */
export type PuckDataTree = {
  root?: { props?: Record<string, unknown> };
  content?: unknown[];
  zones?: Record<string, unknown[]>;
} & Record<string, unknown>;

export interface EmailContentEnvelope {
  /** Bumped only when the wire shape of a node changes. */
  schema_version: number;
  /** Per-language content trees keyed by BCP-47 language code. */
  languages: Record<string, PuckDataTree>;
}

export function emptyEmailEnvelope(): EmailContentEnvelope {
  return { schema_version: CURRENT_EMAIL_SCHEMA_VERSION, languages: {} };
}
