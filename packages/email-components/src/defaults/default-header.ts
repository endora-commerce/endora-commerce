import type { PuckDataTree } from '../schema/envelope.js';

export const DEFAULT_HEADER_BLOCK_CODE = 'default_email_header';

/** Shared TE + newsletter system header — logo from branding, simple stack. */
export function defaultHeaderTree(): PuckDataTree {
  return {
    root: { props: {} },
    content: [
      {
        type: 'transactional_emails.EmailSpacer',
        props: { id: 'default-header-spacer-top', height: 24 },
      },
      {
        type: 'transactional_emails.EmailLogo',
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
        type: 'transactional_emails.EmailSpacer',
        props: { id: 'default-header-spacer-mid', height: 12 },
      },
      {
        type: 'transactional_emails.EmailDivider',
        props: { id: 'default-header-divider', thickness: 1, color: '#e5e7eb' },
      },
    ],
    zones: {},
  };
}
