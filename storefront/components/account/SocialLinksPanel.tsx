import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import type { MfaSocialLink } from '../../lib/api/mfa';

/**
 * The identities linked to this account, on the account security page
 * (issue #194).
 *
 * The page fetched `socialLinks` and rendered none of it, because the server
 * always sent an empty array — so a buyer who had signed in with Google could
 * neither see the link nor sever it, on the one screen that exists to answer
 * exactly that.
 *
 * **The unlink control is rendered from the server's verdict, never from a
 * count taken here.** An account created *by* a federated sign-in holds a
 * random password nobody was ever told, so removing its only link removes the
 * only way its holder gets in. The backend decides that (`canUnlink` +
 * `unlinkBlockedReason`) and refuses the write regardless of what this renders;
 * what the panel adds is telling the buyer *before* the click, and offering the
 * repair — set a password — instead of a dead end.
 *
 * No linked identity ⇒ no panel. An empty "Linked accounts" heading is a
 * question the reader did not ask (Law of Prägnanz).
 */
export function SocialLinksPanel({
  links,
  locale,
  unlinkAction,
}: {
  links: readonly MfaSocialLink[];
  locale: string;
  /** Server action: reads `provider` off the submitted form. */
  unlinkAction: (formData: FormData) => Promise<void>;
}): ReactNode {
  if (links.length === 0) return null;
  const t = tForLocale(locale);

  return (
    <section>
      <h2>{t('account.socialLinks.heading')}</h2>
      <p>{t('account.socialLinks.intro')}</p>
      <ul>
        {links.map((link) => (
          <li key={link.provider} data-provider={link.provider}>
            <p>
              <strong>{providerLabel(link.provider)}</strong> — {link.email}
            </p>
            <p className="b2b-auth__hint">
              {t('account.socialLinks.linkedOn')}{' '}
              <time dateTime={link.linkedAt}>{link.linkedAt.slice(0, 10)}</time>
            </p>
            {link.canUnlink ? (
              <form action={unlinkAction} className="b2b-auth__form">
                <input type="hidden" name="provider" value={link.provider} />
                <div className="b2b-auth__actions">
                  <button type="submit">
                    {t('account.socialLinks.remove')}
                    {/* The provider is in the button's own name, not only in
                        the row above it: a screen reader reaching a bare
                        "Remove" out of context cannot tell the two rows
                        apart (WCAG 2.4.6). */}
                    <span className="sr-only"> {providerLabel(link.provider)}</span>
                  </button>
                </div>
              </form>
            ) : (
              <p className="b2b-auth__hint">
                {t('account.socialLinks.lastCredential')}{' '}
                <a href="/account/password">{t('account.socialLinks.setPassword')}</a>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The provider's own brand name. Deliberately not a translated string: it is a
 * proper noun, and it is what the buyer sees on the button they clicked.
 */
function providerLabel(provider: MfaSocialLink['provider']): string {
  return provider === 'google' ? 'Google' : 'Microsoft';
}
