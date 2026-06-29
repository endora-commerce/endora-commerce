// Default email header block content (feature 047, FR-020).
//
// Renders the resolved branding logo (via the {{var branding.logoUrl}}
// directive) centered at the top of the email. Seeded as a system block
// (`default_email_header`) and auto-inserted into new emails.

import type { PuckDataTree } from '../schema/envelope.js';

export const DEFAULT_HEADER_BLOCK_CODE = 'default_email_header';

export function defaultHeaderTree(): PuckDataTree {
  return {
    root: { props: {} },
    content: [
      {
        type: 'EmailSpacer',
        props: { id: 'default-header-spacer-top', height: 24 },
      },
      {
        type: 'EmailImage',
        props: {
          id: 'default-header-logo',
          src: '{{var branding.logoUrl}}',
          alt: 'Logo',
          href: '',
          width: 160,
          align: 'center',
        },
      },
      {
        type: 'EmailDivider',
        props: { id: 'default-header-divider' },
      },
    ],
    zones: {},
  };
}
