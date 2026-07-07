// Page Builder content envelope — feature 014 / research.md R5.
//
// Every saved CMS content tree (cms_pages.content, cms_blocks.content,
// cms_templates.content) is wrapped in this envelope. `schema_version` is
// bumped only when the wire shape of a node changes; the boot-time upgrader
// (backend/src/modules/cms/services/content-schema-upgrader.ts) walks every
// row and rewrites trees in place when a bump is taken.

export const CURRENT_SCHEMA_VERSION = 2 as const;

/**
 * A single Puck data tree as produced by the editor for one language.
 * Treated as opaque at this layer — Puck's actual type lives in
 * `@measured/puck` and may change across pre-1.0 bumps; we round-trip the
 * shape verbatim through the envelope.
 */
export type PuckDataTree = {
  root?: { props?: Record<string, unknown> };
  content?: unknown[];
  zones?: Record<string, unknown[]>;
} & Record<string, unknown>;

export interface ContentEnvelope {
  /** Bumped when the wire shape of a node changes (not when a new component is added). */
  schema_version: number;
  /** Per-language content trees keyed by BCP-47 language code. */
  languages: Record<string, PuckDataTree>;
}

export function emptyEnvelope(): ContentEnvelope {
  return { schema_version: CURRENT_SCHEMA_VERSION, languages: {} };
}
