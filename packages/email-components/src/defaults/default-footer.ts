import type { PuckDataTree } from '../schema/envelope.js';

export const DEFAULT_FOOTER_BLOCK_CODE = 'default_email_footer';

/**
 * Shared TE + newsletter system footer.
 * Newsletter send injects `unsubscribeUrl`; TE leaves the link empty when unset.
 */
export function defaultFooterTree(): PuckDataTree {
  return {
    root: { props: {} },
    content: [
      {
        type: 'EmailDivider',
        props: { id: 'default-footer-divider', thickness: 1, color: '#e5e7eb' },
      },
      {
        type: 'EmailSpacer',
        props: { id: 'default-footer-spacer-top', height: 12 },
      },
      {
        type: 'EmailFooterLegal',
        props: {
          id: 'default-footer-legal',
          text:
            'You are receiving this email because of activity related to your account.\n' +
            '<a href="{{var unsubscribeUrl}}">Unsubscribe</a>',
          align: 'center',
        },
      },
      {
        type: 'EmailSpacer',
        props: { id: 'default-footer-spacer-bottom', height: 24 },
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
