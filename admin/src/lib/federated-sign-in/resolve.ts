import type { MfaSocialProvider } from '@endora-commerce/contracts';

/**
 * Which federated sign-in buttons the pre-auth admin screen may render —
 * issue #193.
 *
 * Two independent inputs, and both can be unresolved on a screen that has to
 * paint immediately:
 *
 *  - **presence** — is `mfa` effectively present (platform availability AND
 *    operator activation)? Read from the server's projection, never a
 *    hard-coded module list (Constitution XVII item 5);
 *  - **options** — which providers are configured *and* enabled for the admin
 *    surface? Answered by the `mfa`-owned availability endpoint, which lists
 *    only the providers that can complete a sign-in.
 *
 * Three-valued rather than a plain array, because "not known yet" and "there
 * are none" have to render differently, and neither may render a button that
 * later disappears out from under a cursor.
 *
 * Pure, and in its own module so it is testable without mounting the screen.
 */
export type FederatedProvider = MfaSocialProvider;

export type FederatedSignInStatus = 'unknown' | 'none' | 'ready';

export interface FederatedSignInState {
  status: FederatedSignInStatus;
  /** Empty unless `status === 'ready'`. Order is the server's, preserved. */
  providers: readonly FederatedProvider[];
}

export interface FederatedSignInInput {
  /** `undefined` while the presence projection has not landed. */
  modulePresent: boolean | undefined;
  /** `undefined` while the availability read has not landed. */
  availableProviders: readonly FederatedProvider[] | undefined;
}

/**
 * `mfa` absent short-circuits to `none` **without waiting for the options
 * read**: `mfa` owns that endpoint, so waiting on it only delays a decision
 * presence has already made.
 *
 * Unresolved fails **closed** here, unlike `ModulePresenceProvider`'s
 * degrade-open. The trade-off is not the same one: an admin with no presence
 * projection would otherwise face an empty sidebar and no way to diagnose it,
 * whereas an admin with no federated projection still has the password form —
 * which is the route every admin account is guaranteed to have.
 */
export function resolveFederatedSignIn(
  input: FederatedSignInInput,
): FederatedSignInState {
  if (input.modulePresent === false) return { status: 'none', providers: [] };
  if (input.modulePresent === undefined) return { status: 'unknown', providers: [] };
  if (input.availableProviders === undefined) {
    return { status: 'unknown', providers: [] };
  }
  if (input.availableProviders.length === 0) return { status: 'none', providers: [] };
  return { status: 'ready', providers: input.availableProviders };
}
