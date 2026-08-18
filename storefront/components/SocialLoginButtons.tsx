import type { ReactNode } from 'react';
import { tForLocale, type MessageKey } from '../lib/i18n/messages';
import {
  resolveFederatedSignIn,
  type FederatedProvider,
  type FederatedSignInState,
} from '../lib/federated-sign-in';

/**
 * Federated sign-in buttons (feature 042, US4; corrected by issue #193).
 *
 * Anchor links to the backend OAuth `start` endpoint — absolute, because the
 * hand-off runs in the browser against the backend origin.
 *
 * **A provider the platform cannot complete a sign-in with is absent, not
 * disabled.** The caller resolves that (module presence AND provider
 * configured AND provider enabled for this channel) and passes the result in;
 * this component renders exactly what it is given and `null` for anything
 * else. It used to render both providers unconditionally while both settings
 * default to `false`, so a fresh deployment advertised two dead routes.
 *
 * Three renderings, and the third is the one that used to be missing:
 *
 *  - **`ready`** — the rule, the "or", and one button per provider;
 *  - **`none`** — `null`. The divider and its label go with the buttons; a rule
 *    left standing under a password form introduces nothing and is a worse
 *    defect than the buttons were (Law of Prägnanz, Signal-to-Noise);
 *  - **`unknown`** — `null`, and no reserved height. Deliberate: see the note
 *    on the loading gap below.
 *
 * The divider stays for a **single** provider. It is not a list introduction —
 * it marks the shift from "credentials you type" to "an identity you already
 * hold", and without it a lone bordered button under the filled submit reads as
 * a second step in the same form rather than an alternative route to the same
 * place (Von Restorff: one primary CTA per view, everything else subordinate).
 *
 * ## The loading gap
 *
 * On the storefront there is none: both inputs resolve server-side before the
 * HTML is sent, so this renders its final shape on first paint and the page
 * stays SSR-capable (Constitution VII). The `unknown` branch exists because the
 * decision function is shared with clients that do have a gap, and because a
 * failed presence read must not be able to fabricate buttons.
 */
export function SocialLoginButtons({
  backendBaseUrl,
  next,
  locale,
  modulePresent,
  availableProviders,
}: {
  backendBaseUrl: string;
  next: string;
  locale: string;
  /** `mfa` effective presence, projected from `/module-presence`. */
  modulePresent: boolean | undefined;
  /** Providers that are configured AND enabled for this channel. */
  availableProviders: readonly FederatedProvider[] | undefined;
}): ReactNode {
  const state: FederatedSignInState = resolveFederatedSignIn({
    modulePresent,
    availableProviders,
  });
  if (state.status !== 'ready') return null;

  const t = tForLocale(locale);
  const href = (provider: FederatedProvider): string =>
    `${backendBaseUrl}/api/v1/auth/customer/oauth/${provider}/start?next=${encodeURIComponent(next)}`;

  return (
    <div
      className="b2b-auth__social"
      role="group"
      aria-label={t('auth.federated.groupLabel')}
    >
      {/* Presentational rule; the group's `aria-label` carries the meaning, so
          the word itself is hidden from the accessibility tree rather than
          announced as a stray "or" between two links. */}
      <div className="b2b-auth__social-divider" aria-hidden="true">
        <span>{t('auth.federated.divider')}</span>
      </div>
      {state.providers.map((provider) => (
        <a
          key={provider}
          className="b2b-auth__social-btn"
          href={href(provider)}
          data-provider={provider}
        >
          {t(providerLabelKey(provider))}
        </a>
      ))}
    </div>
  );
}

/** Closed over the contract enum, so a new provider fails to compile here. */
function providerLabelKey(provider: FederatedProvider): MessageKey {
  return provider === 'google' ? 'auth.federated.google' : 'auth.federated.microsoft';
}
