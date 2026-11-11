import type {
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  CustomFieldOptionDto,
} from '@endora-commerce/contracts';

/**
 * Shared fixtures of feature 162's two `/custom-fields` suites
 * (`CustomFieldsPage.carry.test.tsx`, `CustomFieldsPage.carry-drift.test.tsx`):
 * the registry's carry pairs and a definition builder.
 */

/** The registry's pairs: a Quote Request carries to an Order and an Opportunity; an Order never to a Quote Request. */
export const CARRY_ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'quote_request', labelKey: 'customFields.entity.quoteRequest', listFilter: false, carryTargets: ['order', 'opportunity'], customerInputSurfaces: [] },
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true, carryTargets: ['opportunity'], customerInputSurfaces: [] },
  { entityType: 'opportunity', labelKey: 'customFields.entity.opportunity', listFilter: false, carryTargets: ['order', 'quote_request'], customerInputSurfaces: [] },
  { entityType: 'category', labelKey: 'customFields.entity.category', listFilter: false, carryTargets: [], customerInputSurfaces: [] },
];

let sequence = 0;

export function option(value: string, sortOrder: number): CustomFieldOptionDto {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-0000000a${String(sequence).padStart(4, '0')}`,
    value,
    label: {},
    labelDefault: value.charAt(0).toUpperCase() + value.slice(1),
    isDefault: false,
    sortOrder,
  };
}

export function carryDefinition(
  id: string,
  overrides: Partial<CustomFieldDefinitionDto> & { optionValues?: string[] },
): CustomFieldDefinitionDto {
  const { optionValues = ['north', 'south'], ...rest } = overrides;
  return {
    id,
    entityType: 'quote_request',
    key: 'region',
    label: {},
    labelDefault: 'Region',
    valueType: 'select',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: {},
    listFilter: false,
    carryTo: [],
    customerInput: [],
    adminAccess: 'edit',
    options: optionValues.map((value, index) => option(value, index)),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  };
}

/** A bundle sentence with its `{name}` parameters filled, as the operator reads it. */
export function sentence(bundle: Record<string, string>, key: string, params: Record<string, string> = {}): string {
  const text = bundle[key];
  if (text === undefined) throw new Error(`No bundle entry ${key}`);
  return text.replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? '');
}
