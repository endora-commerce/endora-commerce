/**
 * Command Registry (feature 054, FR-009).
 *
 * The single allow-list of known Command actions. Two consumers:
 *  1. the FR-009 coverage check (`scripts/check-command-coverage.ts`) — an action
 *     recognized here counts as "runs through a Command";
 *  2. operator-facing undo affordances — `reversible` marks which actions can be undone.
 *
 * Entries are added as writes are migrated to Commands (module by module).
 */

export interface CommandRegistryEntry {
  /** Whether this command captures pre-state and exposes an operator-facing undo. */
  readonly reversible: boolean;
  /** Optional human-facing note (English), e.g. what the action mutates. */
  readonly description?: string;
}

/**
 * Known command actions. Keep dot-namespaced (audit convention:
 * `product.update`, `credit_limit.adjust`, …). Extend as modules migrate.
 */
export const COMMAND_REGISTRY = {
  // Credit-limit adjustment (US1). Previously an unaudited write — the Command
  // adds the missing co-transactional audit entry.
  'credit_limit.adjust': { reversible: false, description: 'Adjust an organization credit limit' },
  // Price-list update (US1).
  'price_list.update': { reversible: false, description: 'Update a price list' },
  // Product update via the admin single-edit path (US1).
  'product.update': { reversible: false, description: 'Update a product (admin single edit)' },
  // Reversible bulk edit + its undo (US2). Registered ahead of the catalog
  // conversion so the coverage check and undo affordance recognize them.
  'product.bulk_update': { reversible: true, description: 'Queued bulk edit of products' },
  'product.bulk_update.undo': { reversible: false, description: 'Undo of a bulk product edit' },
} as const satisfies Record<string, CommandRegistryEntry>;

export type KnownCommandAction = keyof typeof COMMAND_REGISTRY;

/** Whether an action string is a registered Command action. */
export function isRegisteredCommand(action: string): action is KnownCommandAction {
  return Object.prototype.hasOwnProperty.call(COMMAND_REGISTRY, action);
}

/** Whether a registered action is reversible (unknown actions are treated as non-reversible). */
export function isReversibleCommand(action: string): boolean {
  return isRegisteredCommand(action) && COMMAND_REGISTRY[action].reversible;
}

/** All registered action names (for the coverage check + admin affordances). */
export function registeredCommandActions(): string[] {
  return Object.keys(COMMAND_REGISTRY);
}
