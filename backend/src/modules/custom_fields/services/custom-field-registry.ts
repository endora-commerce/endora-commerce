import type { SupportedEntityType } from '@b2b/contracts';

/**
 * Supported-entity registry (feature 055, FR-001/FR-006).
 *
 * The single, extensible list of host entity types custom fields may attach to.
 * The admin definition editor and the value validator both consult this map;
 * adding an entity is one entry here plus wiring the host's read/write path
 * (see specs/055-custom-fields-layer/quickstart.md). The generic core stays
 * entity-agnostic — this map carries no host-specific capability logic.
 *
 * `orgOwned` is informational (it drives cross-tenant test selection). Actual
 * tenant isolation is enforced by each host ENTITY's own scope decorator
 * (Principle XI), because a custom-field value is a JSONB column ON the host
 * row — never by this flag.
 */
export interface SupportedEntityMeta {
  /** i18n key for the operator-facing entity-type label. */
  readonly labelKey: string;
  /** True when the host entity is tenant-scoped (org/customer). Category & Organization are global. */
  readonly orgOwned: boolean;
}

export const SUPPORTED_ENTITIES: Record<SupportedEntityType, SupportedEntityMeta> = {
  category: { labelKey: 'customFields.entity.category', orgOwned: false },
  order: { labelKey: 'customFields.entity.order', orgOwned: true },
  organization: { labelKey: 'customFields.entity.organization', orgOwned: false },
  customer: { labelKey: 'customFields.entity.customer', orgOwned: true },
  quote_request: { labelKey: 'customFields.entity.quoteRequest', orgOwned: true },
};

/** All registered entity-type codes. */
export const SUPPORTED_ENTITY_TYPES = Object.keys(SUPPORTED_ENTITIES) as SupportedEntityType[];

/** True when `value` is a registered, live entity type. Definitions for unlisted types are inert. */
export function isSupportedEntityType(value: string): value is SupportedEntityType {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_ENTITIES, value);
}
