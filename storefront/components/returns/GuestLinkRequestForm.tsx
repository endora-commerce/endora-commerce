import type { ReactNode } from 'react';
import type { MessageKey } from '../../lib/i18n/messages';
import { CartSubmitButton } from '../CartSubmitButton';

/**
 * "Enter your e-mail, get a link" (`specs/181-guest-complaints/` design review S-1, S-4): the
 * guest entry's region B and the *link no longer works* page share it. A plain post to the
 * request handler, which works without JavaScript.
 *
 * - The field is a floating-label e-mail input, its hint linked by `aria-describedby`.
 * - A malformed address marks the field and says so under it (FR-090: a sentence, never a code).
 * - The honeypot follows `forms` (`ContactForm`): off-screen, out of the tab order, never
 *   `display:none`, which some bots skip (research R-8).
 */
export function GuestLinkRequestForm({
  t,
  email = '',
  invalid = false,
  from,
  origin,
  submit,
}: {
  t: (key: MessageKey) => string;
  /** Prefilled from this browser's own pending cookie, never from the URL. */
  email?: string;
  invalid?: boolean;
  from?: string;
  /** Which page posted, so the handler's answer returns there. */
  origin: 'entry' | 'invalid';
  submit: MessageKey;
}): ReactNode {
  return (
    <form method="post" action="/returns/guest/request" className="b2b-auth__form" noValidate>
      <input type="hidden" name="origin" value={origin} />
      {from ? <input type="hidden" name="from" value={from} /> : null}
      <div className="b2b-auth__field">
        <label htmlFor="guest-email">{t('returns.guest.entry.email')}</label>
        <input
          id="guest-email"
          name="email"
          type="email"
          inputMode="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder=" "
          defaultValue={email}
          aria-describedby={invalid ? 'guest-email-hint guest-email-error' : 'guest-email-hint'}
          {...(invalid ? { 'aria-invalid': true } : {})}
        />
        {invalid ? (
          <p id="guest-email-error" className="b2b-auth__error m-0">
            {t('returns.guest.errors.email')}
          </p>
        ) : null}
        <p id="guest-email-hint" className="m-0 text-[12px] text-muted">
          {t('returns.guest.entry.emailHint')}
        </p>
      </div>
      <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
        <input name="hp" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <CartSubmitButton
        trackNativeSubmit
        className="btn btn--primary btn--block"
        label={t(submit)}
        pendingLabel={t('returns.guest.entry.sending')}
      />
    </form>
  );
}
