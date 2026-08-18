import { useEffect, useState } from 'react';
import { fetchAdminFederatedProviders, fetchMfaPresence } from './api.js';
import {
  resolveFederatedSignIn,
  type FederatedProvider,
  type FederatedSignInState,
} from './resolve.js';

/**
 * Resolves the federated block for the pre-auth admin screen — issue #193.
 *
 * Both reads are fired **in parallel** on mount, so the gap is one round-trip
 * rather than two. Presence still short-circuits the answer in
 * `resolveFederatedSignIn`, so an absent `mfa` decides `none` the moment the
 * presence response lands, whatever the options read is doing.
 *
 * The state starts `unknown` in both slots, which renders nothing. It never
 * renders a provisional button, because the failure mode this fixes is exactly
 * a button that appears and then leaves under a cursor.
 */
export function useFederatedSignIn(): FederatedSignInState {
  const [modulePresent, setModulePresent] = useState<boolean | undefined>(undefined);
  const [providers, setProviders] = useState<readonly FederatedProvider[] | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [present, available] = await Promise.all([
        fetchMfaPresence(),
        fetchAdminFederatedProviders(),
      ]);
      if (cancelled) return;
      setModulePresent(present);
      setProviders(available);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return resolveFederatedSignIn({ modulePresent, availableProviders: providers });
}
