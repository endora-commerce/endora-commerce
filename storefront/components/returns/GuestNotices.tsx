import type { ReactNode } from 'react';
import type { MessageKey } from '../../lib/i18n/messages';
import { LocalizedLink } from '../../lib/i18n/localized-link';

/**
 * Guest complaints switched off while a visitor was in the flow (`specs/181-guest-complaints/`
 * FR-002; design review S-1 *403*): one sentence saying so, and the contact page the footer
 * links to. A notice, not an error: nothing the visitor did was wrong.
 */
export function GuestDisabledNotice({ t }: { t: (key: MessageKey) => string }): ReactNode {
  return (
    <p className="b2b-auth__notice" role="note">
      {t('returns.guest.disabled')}{' '}
      <LocalizedLink href="/kontakt" rel="noreferrer">
        {t('returns.guest.contact')}
      </LocalizedLink>
    </p>
  );
}
