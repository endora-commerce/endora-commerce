import type { ReactNode } from 'react';
import { Button } from './ui/button.js';
import { Separator } from './ui/separator.js';
import { loginCopy } from '../i18n/preauth-login-copy.js';
import {
  useFederatedSignIn,
  type FederatedProvider,
} from '../lib/federated-sign-in/index.js';

/**
 * Federated sign-in block on the admin login screen (feature 042 US5,
 * corrected by issue #193).
 *
 * **A provider the platform cannot complete a sign-in with is absent, not
 * greyed out.** It renders a button only when `mfa` is effectively present AND
 * that provider is configured (client credentials in backend env) AND its
 * `mfa.admin.<provider>_enabled` setting is on. Both settings default to
 * `false`, so a fresh deployment renders nothing here — which is the whole
 * defect: this screen used to advertise two dead sign-in routes on every
 * default install.
 *
 * Three renderings:
 *
 *  - **`ready`** — a rule with "or", then one outline button per provider;
 *  - **`none`** — `null`. The rule and its label belong to the buttons and go
 *    with them; a divider left standing under a password form introduces
 *    nothing and reads worse than the dead buttons did (Law of Prägnanz);
 *  - **`unknown`** — `null`, with **no reserved height**. See below.
 *
 * The rule stays for a **single** provider. It is not a list introduction — it
 * marks the shift from "credentials you type" to "an identity you already
 * hold". Without it, a lone bordered button directly under the filled submit
 * reads as a second step of the same form rather than an alternative route to
 * the same place (Von Restorff: one primary CTA, everything else subordinate).
 *
 * ## The loading gap, decided rather than defaulted
 *
 * Nothing renders until both inputs resolve, and no skeleton stands in for
 * them. A skeleton would promise an option that, on a default deployment, never
 * arrives; and buttons rendered optimistically would vanish under a cursor
 * mid-click on the most security-sensitive screen in the product. Rendering
 * nothing makes the only transition "nothing → buttons", which **appends below
 * the submit button** and therefore displaces no target the admin is aiming at.
 *
 * Nothing here blocks the password form: this is a sibling of the form, not a
 * wrapper, so email/password/submit are interactive on first paint regardless
 * of what the two reads are doing (Doherty Threshold).
 */
export function FederatedSignIn(): ReactNode {
  const { status, providers } = useFederatedSignIn();
  if (status !== 'ready') return null;

  return (
    <div
      className="flex flex-col gap-2 pt-2"
      role="group"
      aria-label={loginCopy.federatedGroupLabel}
    >
      {/* The rule's word is decorative: the group's `aria-label` carries the
          meaning, so a screen reader is not handed a stray "or" between two
          links. `Separator` is `decorative` by default, so it is already
          `aria-hidden`. */}
      <div className="flex items-center gap-3 pb-1" aria-hidden="true">
        <Separator className="flex-1" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {loginCopy.federatedDivider}
        </span>
        <Separator className="flex-1" />
      </div>
      {providers.map((provider) => (
        <Button key={provider} asChild variant="outline" className="w-full min-h-11">
          <a
            href={`${adminApiBaseUrl}/api/v1/auth/admin/oauth/${provider}/start`}
            data-provider={provider}
          >
            {providerLabel(provider)}
          </a>
        </Button>
      ))}
    </div>
  );
}

const adminApiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

/** Closed over the contract enum, so a new provider fails to compile here. */
function providerLabel(provider: FederatedProvider): string {
  return provider === 'google' ? loginCopy.federatedGoogle : loginCopy.federatedMicrosoft;
}
