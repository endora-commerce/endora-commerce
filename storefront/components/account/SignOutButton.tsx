'use client';

import { releasePushSubscription } from '../../lib/api/pwa';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Release this browser's push subscription, then end the session (#258).
 *
 * The order matters only for clarity — the backend accepts the release from a
 * signed-out browser on the subscription's own keys (#254) — but the release
 * has to happen *here*, in the browser: the subscription lives in the
 * browser's push manager, which the server action cannot reach. Without it a
 * browser a customer had signed out of stayed registered as their device and
 * kept receiving the notifications addressed to their account.
 *
 * `releasePushSubscription` never throws, so signing out always proceeds.
 */
export function signOutReleasingPush(signOut: () => Promise<void>): () => Promise<void> {
  return async () => {
    await releasePushSubscription();
    await signOut();
  };
}

export function SignOutButton({
  signOut,
  label,
  locale,
  className = 'b2b-account__logout',
}: {
  signOut: () => Promise<void>;
  /** The button's caption, already translated by the caller. */
  label?: string;
  /**
   * The page's language, from the server component that renders the button;
   * the caption is `auth.signOut.button` in it when no `label` is given.
   * Optional only until the account sidebar (`app/(account)/layout.tsx`, keyed
   * on the `account` branch of issue #85) passes it; until then that caller
   * gets the English caption it has always had.
   */
  locale?: string;
  className?: string;
}): React.ReactElement {
  const caption = label ?? tForLocale(locale ?? 'en-US')('auth.signOut.button');
  return (
    <form action={signOutReleasingPush(signOut)}>
      <button type="submit" className={className}>
        {caption}
      </button>
    </form>
  );
}
