import type { OrganizationStatus } from '@b2b/contracts';

/**
 * Kernel port — organisation read (feature 072, D-32; retyped by D-55).
 *
 * The Organization is the one tenant concept (Constitution XI), so almost every
 * module needs to read one. The **owner is the `organizations` module**, which
 * registers the default (`OrganizationContextService`) and keeps the entity, its
 * table and its eight migrations.
 *
 * The kernel owns only the shape, and until D-55 that was not true here: all
 * three methods were typed with the module-owned `Organization` entity class, so
 * `@endora-commerce/kernel` reached `@endora-commerce/mod-organizations` — the
 * package cycle F4 cannot start with. {@link OrganizationSnapshot} is the shape
 * the port actually advertises, measured against every caller: `promotions`
 * reads `status`, `carts` and `orders` discard the return value and want the
 * throw, and `loadCartApprovalPolicy` never named an entity at all.
 *
 * `OrganizationStatus` comes from `@b2b/contracts`, which already declares the
 * union the entity re-declares — the second name is the existing one, not a new
 * one. Nothing else moves: TypeScript is structural, so `OrganizationContextService`
 * satisfies this port returning its entity, with no mapping layer and no
 * implementation change.
 *
 * **This is the settled shape, not an interim one.** The entity stays in
 * `organizations` permanently: the Organization's logic belongs to a module, and
 * relocating the class would buy nothing measurable (the mapping layer is nil,
 * the blast radius one file) at the price of splitting six migrations, renaming
 * eight applied classes and a coordinated database rebuild. `src/tenancy` is the
 * precedent that makes it right rather than merely cheap — it enforces
 * Principle XI knowing the Organization as a UUID in a column and never as a
 * class, which is exactly the grip a platform layer needs on the one tenant
 * concept. A consumer that needs a field outside `{id, status}` grows the
 * snapshot by a line; that is what a structural type is for.
 */
export interface OrganizationSnapshot {
  readonly id: string;
  readonly status: OrganizationStatus;
}

export interface OrganizationReadPort {
  /** The Organization, or `null` when it does not exist or is soft-deleted. */
  loadEffectiveOrganization(organizationId: string): Promise<OrganizationSnapshot | null>;

  /**
   * Resolve the Organization and refuse when it may not transact.
   *
   * Returning the organisation it just validated is information this port
   * legitimately advertises; that both current callers discard it is a fact
   * about two call sites, not about the contract.
   *
   * @throws `OrganizationNotFoundError` when the organisation does not exist.
   * @throws `OrganizationCannotTransactError` when its status is not `active`.
   */
  assertCanTransact(organizationId: string): Promise<OrganizationSnapshot>;

  /** Per-organisation cart-approval policy; `false` for a customer with no organisation. */
  loadCartApprovalPolicy(organizationId: string | null): Promise<boolean>;
}
