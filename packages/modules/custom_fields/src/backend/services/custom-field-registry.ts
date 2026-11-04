import type { SupportedEntityType } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

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
  /**
   * Optional list-filter marker (feature 157). When present, definitions of
   * this entity type may be marked as filters of the type's admin list; on any
   * other type the option is refused. Generic, like the markers above: the
   * core asks only whether the type offers the option, never which list uses
   * it.
   */
  readonly listFilter?: true;
  /**
   * Optional carry marker (feature 162). The entity types definitions of this
   * type may carry their values to, when a record of such a type is created
   * from, or joins, a record of this type. A definition's `carryTo` may name
   * only these; on any other type the option is refused. Generic, like the
   * markers above: the core asks only whether a pair is listed, never which
   * hosts make the conversion.
   */
  readonly carryTargets?: readonly SupportedEntityType[];
  /**
   * Optional Page Builder marker (feature 172). When present, definitions of
   * this entity type may take the `page_builder` value type — a Page Builder
   * document per language, which the host stores in its own storage rather
   * than in the value bag. On any other type the value type is refused with
   * `value_type_unsupported`. Generic, like the markers above: the core asks
   * only whether the type offers it, never which host stores the documents.
   */
  readonly pageBuilderValues?: true;
}

export const SUPPORTED_ENTITIES: Record<SupportedEntityType, SupportedEntityMeta> = {
  category: { labelKey: 'customFields.entity.category', orgOwned: false },
  order: {
    labelKey: 'customFields.entity.order',
    orgOwned: true,
    listFilter: true,
    carryTargets: ['opportunity'],
  },
  organization: { labelKey: 'customFields.entity.organization', orgOwned: false },
  customer: { labelKey: 'customFields.entity.customer', orgOwned: true },
  // Feature 157 — a Quote Request belongs to `quote_requests`, and its
  // definitions follow that module's presence as an Opportunity's follow `crm`.
  quote_request: {
    labelKey: 'customFields.entity.quoteRequest',
    orgOwned: true,
    ownerModuleId: 'quote_requests',
    listFilter: true,
    carryTargets: ['order', 'opportunity'],
  },
  product: {
    labelKey: 'customFields.entity.product',
    // Definitions are platform-global; product rows are catalog data, not org-tenant rows.
    orgOwned: false,
    managedBy: {
      moduleId: 'catalog',
      labelKey: 'customFields.managedBy.catalogAttributes',
      route: '/catalog/attributes',
    },
    // Feature 172 — product content attributes hold Page Builder documents.
    pageBuilderValues: true,
  },
  opportunity: {
    labelKey: 'customFields.entity.opportunity',
    orgOwned: true,
    ownerModuleId: 'crm',
    listFilter: true,
    carryTargets: ['quote_request', 'order'],
  },
  // Feature 163 — a Project belongs to `projects`, and its definitions follow
  // that module's presence. No carry targets: nothing is created from a Project.
  project: {
    labelKey: 'customFields.entity.project',
    orgOwned: true,
    ownerModuleId: 'projects',
    listFilter: true,
  },
  // Feature 165 — a Task belongs to `tasks`, and its definitions follow that
  // module's presence. Tasks carry no Organization of their own (their tenancy
  // is their context's rule), so their definitions are platform-wide. No carry
  // targets: nothing is created from a Task.
  task: {
    labelKey: 'customFields.entity.task',
    orgOwned: false,
    ownerModuleId: 'tasks',
    listFilter: true,
  },
};

/** All registered entity-type codes. */
export const SUPPORTED_ENTITY_TYPES = Object.keys(SUPPORTED_ENTITIES) as SupportedEntityType[];

/** True when `value` is a registered, live entity type. Definitions for unlisted types are inert. */
export function isSupportedEntityType(value: string): value is SupportedEntityType {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_ENTITIES, value);
}

/**
 * Whether an entity type is served: when its registry entry names an owner
 * module, only while that module is effectively present (feature 143). A type
 * that is not served is not offered, its definitions are neither answered nor
 * changed, and no list filters on it (Constitution XVII). A type that names no
 * owner — or that the registry does not hold — is not this rule's to refuse.
 * Generic: the one question asked is whether the named module is present.
 */
export function isEntityTypeServed(entityType: string): boolean {
  const owner = isSupportedEntityType(entityType) ? SUPPORTED_ENTITIES[entityType].ownerModuleId : undefined;
  return !owner || effectiveState.isPresent(owner);
}

/** The entity types definitions of `entityType` may carry their values to (feature 162). */
export function carryTargetsOf(entityType: string): readonly SupportedEntityType[] {
  return isSupportedEntityType(entityType) ? (SUPPORTED_ENTITIES[entityType].carryTargets ?? []) : [];
}

/** Whether definitions of `entityType` may be marked as list filters (feature 157). */
export function offersListFilter(entityType: string): boolean {
  return isSupportedEntityType(entityType) && SUPPORTED_ENTITIES[entityType].listFilter === true;
}

/** Whether definitions of `entityType` may take the `page_builder` value type (feature 172). */
export function offersPageBuilderValues(entityType: string): boolean {
  return isSupportedEntityType(entityType) && SUPPORTED_ENTITIES[entityType].pageBuilderValues === true;
}
