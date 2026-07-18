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
  // Orders module (US1).
  'order_status.create': { reversible: false, description: 'Create an order status' },
  'order_status.update': { reversible: false, description: 'Update an order status' },
  'order_status.delete': { reversible: false, description: 'Delete an order status' },
  'order_status.set_transitions': { reversible: false, description: 'Edit order status transitions' },
  'order.status_transition': { reversible: false, description: 'Apply an order status transition' },
  'order.payment_status_transition': { reversible: false, description: 'Change an order payment status' },
  // Inventory module (US1).
  'warehouse.delete': { reversible: false, description: 'Delete a warehouse' },
  'warehouse_channel.assign': { reversible: false, description: 'Assign a warehouse to a channel' },
  'warehouse_channel.update': { reversible: false, description: 'Update a warehouse-channel assignment' },
  'warehouse_channel.unassign': { reversible: false, description: 'Unassign a warehouse from a channel' },
  // Returns / RMA module (US1).
  'return_status.create': { reversible: false, description: 'Create a return status' },
  'return_status.update': { reversible: false, description: 'Update a return status' },
  'return_status.delete': { reversible: false, description: 'Delete a return status' },
  'return_status.replace_transitions': { reversible: false, description: 'Replace return status transitions' },
  'return_reason.create': { reversible: false, description: 'Create a return reason' },
  'return_reason.update': { reversible: false, description: 'Update a return reason' },
  'return_reason.delete': { reversible: false, description: 'Delete a return reason' },
  'return_delivery_method.create': { reversible: false, description: 'Create a return delivery method' },
  'return_delivery_method.update': { reversible: false, description: 'Update a return delivery method' },
  'return_delivery_method.delete': { reversible: false, description: 'Delete a return delivery method' },
  'return_case.create': { reversible: false, description: 'Create a return/RMA case' },
  'return_case.select_delivery_method': { reversible: false, description: 'Select a return delivery method on a case' },
  'return_shipment.create': { reversible: false, description: 'Record a return shipment' },
  'return_shipment.receive': { reversible: false, description: 'Receive a return shipment' },
  // Quote Requests / RFQ module (US1).
  'quote_request.create': { reversible: false, description: 'Create a quote request' },
  'quote_request.patch_draft': { reversible: false, description: 'Patch a pending quote request' },
  'quote_request.resubmit': { reversible: false, description: 'Resubmit a quote request' },
  'quote_request.respond_to_revision': { reversible: false, description: 'Respond to an RFQ revision' },
  'quote_request.convert_to_order': { reversible: false, description: 'Convert an RFQ to an order/cart' },
  'quote_request.approve': { reversible: false, description: 'Approve a quote request' },
  'quote_request.cancel': { reversible: false, description: 'Cancel a quote request' },
  'quote_request.assign': { reversible: false, description: 'Assign a quote request to an admin' },
  'quote_request.modify': { reversible: false, description: 'Modify a quote request (admin revision)' },
  'quote_request.create_on_behalf': { reversible: false, description: 'Admin creates a quote request on behalf' },
  // Organizations module (US1).
  'organization.register': { reversible: false, description: 'Register an organization (self-service)' },
  'organization.email_verified': { reversible: false, description: 'Verify an organization email / activate' },
  'organization.invite': { reversible: false, description: 'Invite a member to an organization' },
  'organization.invite_revoke': { reversible: false, description: 'Revoke an organization invitation' },
  'organization.invite_accept': { reversible: false, description: 'Accept an organization invitation' },
  'organization.allow_lists_replace': { reversible: false, description: 'Replace organization allow-lists' },
  'organization.allow_list_patch': { reversible: false, description: 'Patch an organization allow-list' },
  'organization.tax_id_validation': { reversible: false, description: 'Validate an organization tax ID' },
  'organization.sales_rep_assign': { reversible: false, description: 'Assign a sales rep to an organization' },
  'organization.sales_rep_unassign': { reversible: false, description: 'Unassign a sales rep from an organization' },
  // Promotions module (US1).
  'promotion.create': { reversible: false, description: 'Create a promotion' },
  'promotion.update': { reversible: false, description: 'Update a promotion' },
  'promotion.delete': { reversible: false, description: 'Delete a promotion' },
  'promotion_rule.create': { reversible: false, description: 'Create a named promotion rule' },
  'promotion_rule.update': { reversible: false, description: 'Update a named promotion rule' },
  'promotion_rule.delete': { reversible: false, description: 'Delete a named promotion rule' },
  'coupon.create_single': { reversible: false, description: 'Create a single coupon' },
  'coupon.generate_batch': { reversible: false, description: 'Generate a coupon batch' },
  'coupon.set_active_bulk': { reversible: false, description: 'Bulk toggle coupon active state' },
  // Customer accounts module (US1) — security-sensitive account writes.
  'customer_account.change_password': { reversible: false, description: 'Customer changes their password' },
  'customer_account.password_reset': { reversible: false, description: 'Customer password reset (token)' },
  'customer_account.change_role': { reversible: false, description: 'Change an org member role' },
  'customer_account.remove_member': { reversible: false, description: 'Remove an org member' },
  'customer_account.mfa_enrol_start': { reversible: false, description: 'Start customer 2FA enrolment' },
  'customer_account.mfa_enabled': { reversible: false, description: 'Confirm customer 2FA' },
  'customer_account.mfa_disabled': { reversible: false, description: 'Disable customer 2FA' },
  // Assets library module (US1).
  'asset.upload': { reversible: false, description: 'Upload an asset' },
  'asset.update': { reversible: false, description: 'Update asset metadata' },
  'asset.soft_delete': { reversible: false, description: 'Soft-delete an asset' },
  'asset.restore': { reversible: false, description: 'Restore a soft-deleted asset' },
  'asset.move': { reversible: false, description: 'Move an asset to a folder' },
  'asset.move_many': { reversible: false, description: 'Move multiple assets to a folder' },
  'asset_folder.create': { reversible: false, description: 'Create an asset folder' },
  'asset_folder.update': { reversible: false, description: 'Update an asset folder' },
  'asset_folder.delete': { reversible: false, description: 'Delete an asset folder' },
  // Dictionaries module (US1) — admin reference data.
  'country.create': { reversible: false, description: 'Create a country' },
  'country.update': { reversible: false, description: 'Update a country' },
  'country.set_default': { reversible: false, description: 'Set the default country' },
  'country.delete': { reversible: false, description: 'Delete a country' },
  'language_country.upsert': { reversible: false, description: 'Upsert a language-country association' },
  'language_country.delete': { reversible: false, description: 'Delete a language-country association' },
  'dictionary_translation.upsert': { reversible: false, description: 'Upsert a dictionary translation' },
  'dictionary_translation.delete': { reversible: false, description: 'Delete a dictionary translation' },
  // Currencies module (US1).
  'currency.create': { reversible: false, description: 'Create a currency' },
  'currency.upsert': { reversible: false, description: 'Upsert a currency' },
  'currency.update': { reversible: false, description: 'Update a currency' },
  'currency.set_default': { reversible: false, description: 'Set the default currency' },
  'currency.delete': { reversible: false, description: 'Delete a currency' },
  // Languages module (US1).
  'language.create': { reversible: false, description: 'Create a language' },
  'language.upsert': { reversible: false, description: 'Upsert a language' },
  'language.update': { reversible: false, description: 'Update a language' },
  'language.set_default': { reversible: false, description: 'Set the default language' },
  'language.delete': { reversible: false, description: 'Delete a language' },
  // MFA module (US1) — security-sensitive 2FA writes.
  'mfa.setup': { reversible: false, description: 'Begin a 2FA enrolment' },
  'mfa.activate': { reversible: false, description: 'Activate a 2FA enrolment' },
  'mfa.reset': { reversible: false, description: 'Admin-reset a subject 2FA' },
  'mfa.disable': { reversible: false, description: 'Disable a subject 2FA' },
  'mfa.regenerate_recovery_codes': { reversible: false, description: 'Regenerate 2FA recovery codes' },
  'mfa.set_org_enforcement': { reversible: false, description: 'Set org 2FA enforcement policy' },
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
