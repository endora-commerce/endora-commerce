import { CUSTOM_FIELD_HOST_BINDINGS, type SupportedEntityType } from '@endora-commerce/contracts';

/** Where one host entity type stores its custom-field value bag. */
export interface HostStorageBinding {
  readonly table: string;
  readonly column: string;
}

/**
 * Host-table binding for the reads `custom_fields` makes over the host rows
 * (read-only introspection, feature 055; generalized to a per-host
 * `{table, column}` pair by feature 061 — the `product` host stores its value
 * bag in `products.attribute_values`). The definition-change guards probe it,
 * and the list-filter port (`specs/157-custom-fields-list-filters/`) builds its
 * condition against it.
 *
 * The registry itself is `@endora-commerce/contracts`'
 * `CUSTOM_FIELD_HOST_BINDINGS` (`specs/178-extensible-columns/` FR-010): the
 * platform derives its extensible host tables from the same declaration, so
 * this reads it rather than holding a second copy.
 */
export function hostStorageBinding(entityType: SupportedEntityType): HostStorageBinding {
  const binding = CUSTOM_FIELD_HOST_BINDINGS[entityType];
  return { table: binding.table, column: binding.valueColumn };
}
