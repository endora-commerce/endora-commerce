// Default email footer block content (feature 047, FR-020).
//
// Seeded as a system block (`default_email_footer`) and auto-inserted into new
// emails. Authors edit it once to update every email that embeds it.

import type { PuckDataTree } from '../schema/envelope.js';

export const DEFAULT_FOOTER_BLOCK_CODE = 'default_email_footer';

export function defaultFooterTree(): PuckDataTree {
  return {
    root: { props: {} },
    content: [
      {
        type: 'EmailDivider',
        props: { id: 'default-footer-divider' },
      },
      {
        type: 'EmailText',
        props: {
          id: 'default-footer-text',
          text: 'You are receiving this email because of activity on your account.',
          align: 'center',
        },
      },
      {
        type: 'EmailSpacer',
        props: { id: 'default-footer-spacer', height: 24 },
      },
    ],
    zones: {},
  };
}

/** Build a single-language content envelope from a tree, for the given languages. */
export function envelopeFromTree(
  tree: PuckDataTree,
  languages: readonly string[],
): { schema_version: number; languages: Record<string, PuckDataTree> } {
  const byLang: Record<string, PuckDataTree> = {};
  for (const lang of languages) byLang[lang] = tree;
  return { schema_version: 1, languages: byLang };
}
