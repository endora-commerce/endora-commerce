import type { MfaSocialProvider } from '@b2b/contracts';

/**
 * Which federated sign-in buttons a surface may render — issue #193.
 *
 * Two independent inputs decide it, and both can be unresolved:
 *
 *  - **presence** — is `mfa` effectively present (platform availability AND
 *    operator activation)? Projected from `/module-presence`, never inferred
 *    from a 503 (Constitution XVII item 5);
 *  - **options** — which providers are configured *and* enabled for this
 *    surface and sales channel? Answered by the `mfa`-owned availability
 *    endpoint, which lists only the providers that can complete a sign-in.
 *
 * The answer is a three-valued status rather than a plain array, because
 * "we do not know yet" and "there are none" must render differently: the
 * former renders nothing *and reserves nothing*, the latter renders nothing
 * *permanently*, and neither may render a button that later disappears.
 *
 * Pure and exported so the decision is unit-testable without a DOM — the
 * storefront test harness is SSR-only.
 */
export type FederatedProvider = MfaSocialProvider;

export type FederatedSignInStatus =
  /** At least one input is still unresolved. Render nothing; do not reserve space. */
  | 'unknown'
  /** Resolved, and this surface offers no federated route at all. */
  | 'none'
  /** Resolved, and at least one provider can complete a sign-in. */
  | 'ready';

export interface FederatedSignInState {
  status: FederatedSignInStatus;
  /** Empty unless `status === 'ready'`. Order is the caller's, preserved. */
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
 * read**: the module owns that endpoint, so waiting for it would only delay a
 * decision presence has already made — and on a surface where the alternative
 * is a button that pops in late, deciding early is the whole point.
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
