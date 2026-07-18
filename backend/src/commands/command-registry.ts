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
  // Credit-limit grant + adjustment (US1). Previously unaudited writes — the
  // Commands add the missing co-transactional audit entry.
  'credit_limit.grant': { reversible: false, description: 'Grant an organization credit limit' },
  'credit_limit.adjust': { reversible: false, description: 'Adjust an organization credit limit' },
  // Price-list writes (US1).
  'price_list.create': { reversible: false, description: 'Create a price list' },
  'price_list.update': { reversible: false, description: 'Update a price list' },
  'price_list.activate': { reversible: false, description: 'Activate a price list' },
  'price_list.expire': { reversible: false, description: 'Expire a price list' },
  'price_list.draftify': { reversible: false, description: 'Return a price list to draft' },
  'price_list.duplicate': { reversible: false, description: 'Duplicate a price list' },
  'price_list.delete': { reversible: false, description: 'Delete a price list' },
  'price_list.product_add': { reversible: false, description: 'Add a product to a price list' },
  'price_list.product_remove': { reversible: false, description: 'Remove a product from a price list' },
  'price_list.products_replace': { reversible: false, description: 'Replace a price list product roster' },
  'price_list.bracket_update': { reversible: false, description: 'Update price brackets' },
  'price_list.bracket_copy': { reversible: false, description: 'Copy price brackets across currencies' },
  'customer_group.upsert': { reversible: false, description: 'Create or update a customer group' },
  'customer_group.delete': { reversible: false, description: 'Delete a customer group' },
  // Catalog writes (US1) — converted module by module.
  'category.create': { reversible: false, description: 'Create a category' },
  'category.update': { reversible: false, description: 'Update a category' },
  'category.delete': { reversible: false, description: 'Soft-delete a category' },
  'attribute_set.create': { reversible: false, description: 'Create an attribute set' },
  'attribute_set.update': { reversible: false, description: 'Update an attribute set' },
  'attribute_set.delete': { reversible: false, description: 'Delete an attribute set' },
  'product.overrides_apply': { reversible: false, description: 'Apply product value overrides' },
  'packaging_unit.create': { reversible: false, description: 'Create a packaging unit' },
  'packaging_unit.update': { reversible: false, description: 'Update a packaging unit' },
  'packaging_unit.delete': { reversible: false, description: 'Delete a packaging unit' },
  'packaging_unit.reorder': { reversible: false, description: 'Reorder packaging units' },
  'gallery_item.create': { reversible: false, description: 'Create a gallery item' },
  'gallery_item.update': { reversible: false, description: 'Update a gallery item' },
  'gallery_item.delete': { reversible: false, description: 'Delete a gallery item' },
  'grouped_item.add': { reversible: false, description: 'Add a grouped-product child' },
  'grouped_item.update': { reversible: false, description: 'Update a grouped-product child' },
  'grouped_item.delete': { reversible: false, description: 'Remove a grouped-product child' },
  'product_link.bulk_create': { reversible: false, description: 'Create product links' },
  'product_link.delete': { reversible: false, description: 'Remove a product link' },
  'product_link.reorder': { reversible: false, description: 'Reorder product links' },
  'bundle_slot.create': { reversible: false, description: 'Create a bundle slot' },
  'bundle_slot.update': { reversible: false, description: 'Update a bundle slot' },
  'bundle_slot.delete': { reversible: false, description: 'Delete a bundle slot' },
  'bundle_option.add': { reversible: false, description: 'Add a bundle slot option' },
  'bundle_option.remove': { reversible: false, description: 'Remove a bundle slot option' },
  'attachment_type.create': { reversible: false, description: 'Create an attachment type' },
  'attachment_type.update': { reversible: false, description: 'Update an attachment type' },
  'attachment_type.delete': { reversible: false, description: 'Delete an attachment type' },
  'product_attachment.create': { reversible: false, description: 'Create a product attachment' },
  'product_attachment.update': { reversible: false, description: 'Update a product attachment' },
  'product_attachment.delete': { reversible: false, description: 'Delete a product attachment' },
  'product.duplicate': { reversible: false, description: 'Duplicate a product' },
  'attribute.create': { reversible: false, description: 'Create a product attribute' },
  'attribute.update': { reversible: false, description: 'Update a product attribute' },
  'attribute.delete': { reversible: false, description: 'Delete a product attribute' },
  'attribute_option.add': { reversible: false, description: 'Add an attribute option' },
  'attribute_option.update': { reversible: false, description: 'Update an attribute option' },
  'attribute_option.remove': { reversible: false, description: 'Remove an attribute option' },
  'product_variant.create': { reversible: false, description: 'Create a product variant' },
  'product_variant.update': { reversible: false, description: 'Update a product variant' },
  'product_variant.delete': { reversible: false, description: 'Delete a product variant' },
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
