import type { CustomFieldEntityTypeInfo, SupportedEntityType } from '@endora-commerce/contracts';

/**
 * The screens of `/custom-fields` and what one hands the next (issue #1804).
 *
 * The definition editor has its own route — the kit README's five-field rule
 * (*List pages*: a create form opens in a `ModalDialog` when it has up to five
 * fields, its own route otherwise), which the definition form exceeds many
 * times over. `/custom-fields/new` is static, so the palette's *New custom
 * field* can target it (`module-admin-surfaces.md` § Command palette, item 5);
 * the record type it starts on is the `entityType` query, as the list's is.
 */
export const LIST_PATH = '/custom-fields';
export const NEW_PATH = '/custom-fields/new';

/** The query member naming the record type the list shows and a new field starts on. */
export const ENTITY_TYPE_PARAM = 'entityType';

/** The record type the list shows when the address names none. */
export const DEFAULT_ENTITY_TYPE: SupportedEntityType = 'organization';

export const listPath = (entityType: SupportedEntityType): string =>
  `${LIST_PATH}?${ENTITY_TYPE_PARAM}=${encodeURIComponent(entityType)}`;
export const newPath = (entityType: SupportedEntityType): string =>
  `${NEW_PATH}?${ENTITY_TYPE_PARAM}=${encodeURIComponent(entityType)}`;
export const editPath = (id: string): string => `${LIST_PATH}/${encodeURIComponent(id)}`;

/**
 * Pre-API fallback so a screen renders before the entity-types fetch resolves.
 * Only types that declare no owner module: a type that follows a module (a
 * Quote Request follows `quote_requests`, an Opportunity `crm`) is offered once
 * the server says it is, never before.
 */
export const FALLBACK_ENTITY_TYPES: CustomFieldEntityTypeInfo[] = (
  ['category', 'order', 'organization', 'customer'] as SupportedEntityType[]
).map((entityType) => ({
  entityType,
  labelKey: `customFields.entity.${entityType}`,
  // The list-filter option is offered only once the server says the type has it.
  listFilter: false,
  // So are the carry options (feature 162).
  carryTargets: [],
  // And the buyer input surfaces (feature 175).
  customerInputSurfaces: [],
}));

/**
 * The record type an address names, when it is one the screen knows; `null`
 * for none or a value no type has, so the caller falls back rather than
 * reading a type that does not exist.
 */
export function entityTypeFromQuery(
  value: string | null,
  entityTypes: readonly CustomFieldEntityTypeInfo[],
): SupportedEntityType | null {
  if (value === null || value === '') return null;
  return entityTypes.some((info) => info.entityType === value) ? (value as SupportedEntityType) : null;
}

/**
 * What the editor hands the list on a successful save (router `state`): the
 * row to focus and the sentence to announce. Read through `savedFieldFrom`,
 * since `location.state` is whatever the history entry carries.
 */
export interface SavedFieldState {
  customFieldSaved: { id: string; key: string; created: boolean };
}

export function savedFieldFrom(state: unknown): SavedFieldState['customFieldSaved'] | null {
  if (typeof state !== 'object' || state === null) return null;
  const saved = (state as Partial<SavedFieldState>).customFieldSaved;
  if (typeof saved !== 'object' || saved === null) return null;
  const { id, key, created } = saved;
  return typeof id === 'string' && typeof key === 'string' && typeof created === 'boolean'
    ? { id, key, created }
    : null;
}
