import { apiKeyScopeSchema, type ApiKeyScope } from '@endora-commerce/contracts';

/**
 * The two kinds of API key the create form offers (issue #1551, UX audit
 * SHELL-15). The contract knows a key as bound or unbound
 * (`specs/062-distributor-api/contracts/api-key-binding.md` §2); the form asks
 * the same question as a choice, so the binding rules are absorbed by what it
 * offers instead of restated in prose and validation errors (Tesler's Law):
 *
 * - `platform` — unbound. No binding fields; every scope except the order
 *   scopes, which need a binding (B1).
 * - `organization` — bound to an organization, a sales channel and a service
 *   account, all three or the kind is not chosen. Every scope except
 *   `catalog:write`, which stays platform-level (B2).
 *
 * The server still enforces B1–B5; this only stops the form from offering a
 * combination it would refuse.
 */
export type ApiKeyKind = 'platform' | 'organization';

const ORDER_SCOPES: ReadonlySet<ApiKeyScope> = new Set(['orders:read', 'orders:write']);

/** The scopes a key of `kind` may hold, in the contract enum's order. */
export function scopesForKeyKind(kind: ApiKeyKind): readonly ApiKeyScope[] {
  return apiKeyScopeSchema.options.filter((scope) =>
    kind === 'platform' ? !ORDER_SCOPES.has(scope) : scope !== 'catalog:write',
  );
}
