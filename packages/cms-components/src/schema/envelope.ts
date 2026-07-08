// Page Builder content envelope — feature 014.
//
// Every saved CMS content tree (cms_pages.content, cms_blocks.content,
// cms_templates.content) is wrapped in this envelope.

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
  /** Per-language content trees keyed by BCP-47 language code. */
  languages: Record<string, PuckDataTree>;
}

export function emptyEnvelope(): ContentEnvelope {
  return { languages: {} };
}

/** Normalize stored JSONB that may still carry a legacy `schema_version` key. */
export function normalizeContentEnvelope(raw: unknown): ContentEnvelope {
  if (!raw || typeof raw !== 'object') {
    return emptyEnvelope();
  }
  const obj = raw as Record<string, unknown>;
  const languages =
    obj['languages'] && typeof obj['languages'] === 'object' && !Array.isArray(obj['languages'])
      ? (obj['languages'] as Record<string, PuckDataTree>)
      : {};
  return { languages };
}
