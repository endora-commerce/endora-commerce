import type { SupportedEntityType } from '@endora-commerce/contracts';

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
  /**
   * Optional host-managed marker (feature 061). When present, definitions of
   * this entity type are created/edited/deleted ONLY by the named host
   * module's own surface; the generic admin mutation routes refuse writes with
   * 409 `host_managed` and the generic UI renders the type read-only with a
   * link to `route`. Service-level `apply*` calls are NOT affected — they are
   * the host's path. Generic: any future host may claim it; consumers check
   * only for the marker's presence, never which module manages.
   */
  readonly managedBy?: {
    readonly moduleId: string;
    readonly labelKey: string;
    readonly route: string;
  };
  /**
   * Optional owner marker (feature 143). When present, the host entity belongs
   * to a module an operator may switch off, and the type follows it: the
   * entity-types listing omits the type and the generic admin mutation routes
   * refuse its definitions while that module is not effectively present
   * (Constitution XVII — a module that is off behaves as if never installed).
   * Definitions and stored values are left untouched and are offered again
   * when the owner returns. Generic, like `managedBy`: consumers ask only
   * whether the named module is present, never which module it is. A type that
   * declares no owner is always offered.
   */
  readonly ownerModuleId?: string;
}

export const SUPPORTED_ENTITIES: Record<SupportedEntityType, SupportedEntityMeta> = {
  category: { labelKey: 'customFields.entity.category', orgOwned: false },
  order: { labelKey: 'customFields.entity.order', orgOwned: true },
  organization: { labelKey: 'customFields.entity.organization', orgOwned: false },
  customer: { labelKey: 'customFields.entity.customer', orgOwned: true },
  quote_request: { labelKey: 'customFields.entity.quoteRequest', orgOwned: true },
  product: {
    labelKey: 'customFields.entity.product',
    // Definitions are platform-global; product rows are catalog data, not org-tenant rows.
    orgOwned: false,
    managedBy: {
      moduleId: 'catalog',
      labelKey: 'customFields.managedBy.catalogAttributes',
      route: '/catalog/attributes',
    },
  },
  opportunity: { labelKey: 'customFields.entity.opportunity', orgOwned: true, ownerModuleId: 'crm' },
};

/** All registered entity-type codes. */
export const SUPPORTED_ENTITY_TYPES = Object.keys(SUPPORTED_ENTITIES) as SupportedEntityType[];

/** True when `value` is a registered, live entity type. Definitions for unlisted types are inert. */
export function isSupportedEntityType(value: string): value is SupportedEntityType {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_ENTITIES, value);
}
