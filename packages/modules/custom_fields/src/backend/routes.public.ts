import type { FastifyInstance } from 'fastify';
import {
  customFieldInputSurfaceSchema,
  type InputSurfaceField,
  type InputSurfaceFieldsResponse,
  type SupportedEntityType,
} from '@endora-commerce/contracts';
// Imported for its `salesChannelAccess` route-option augmentation (feature 154).
import '@endora-commerce/platform/http';
import type { DefinitionSource } from './services/custom-field-value.service.js';
import {
  customerInputSurfacesOf,
  isEntityTypeServed,
  SUPPORTED_ENTITY_TYPES,
} from './services/custom-field-registry.js';

export interface CustomFieldsPublicDeps {
  /** The per-entity definitions cache — no query per request in the steady state. */
  definitions: DefinitionSource;
}

/**
 * Feature 175 — the anonymous read of the fields a buyer may fill in on an
 * input surface (`specs/175-buyer-input-custom-fields/contracts/input-surface-read.md`).
 *
 * Channel-independent (definitions are platform-global) and reachable on a
 * store closed to anonymous visitors, because the registration it serves is.
 * It answers, per entity type that offers the surface, the live definitions
 * open on it in display order — key, value type, required, and labels in the
 * request's language with `labelDefault` as the fallback. Never a stored
 * value, the audience, the admin access level or `config`. An unknown surface,
 * or one no type offers, is `200` with `entities: {}`: the storefront treats it
 * as "no extra fields", and a 404 would tell it nothing more.
 */
export async function registerCustomFieldsPublicRoutes(
  app: FastifyInstance,
  deps: CustomFieldsPublicDeps,
): Promise<void> {
  app.get<{ Params: { surface: string } }>(
    '/api/v1/custom-fields/input-surfaces/:surface',
    { config: { salesChannelAccess: 'open' } },
    async (request): Promise<InputSurfaceFieldsResponse> => {
      const { surface } = request.params;
      const entities: InputSurfaceFieldsResponse['data']['entities'] = {};
      const parsed = customFieldInputSurfaceSchema.safeParse(surface);
      if (!parsed.success) return { data: { surface, entities } };

      const language = await request.responseLanguage();
      const offering = SUPPORTED_ENTITY_TYPES.filter(
        (entityType) => customerInputSurfacesOf(entityType).includes(parsed.data) && isEntityTypeServed(entityType),
      );
      for (const entityType of offering) {
        const fields = await openFields(deps.definitions, entityType, parsed.data, language);
        if (fields.length > 0) entities[entityType] = fields;
      }
      return { data: { surface, entities } };
    },
  );
}

async function openFields(
  definitions: DefinitionSource,
  entityType: SupportedEntityType,
  surface: string,
  language: string,
): Promise<InputSurfaceField[]> {
  const fields: InputSurfaceField[] = [];
  for (const { definition, options } of await definitions.listForEntity(entityType)) {
    // The same openness the buyer-input validator judges by.
    if (definition.audience !== 'customer' || definition.valueType === 'page_builder') continue;
    if (!(definition.customerInput ?? []).some((name) => name === surface)) continue;
    fields.push({
      key: definition.key,
      valueType: definition.valueType,
      required: definition.required,
      label: definition.label?.[language] || definition.labelDefault,
      options: [...options]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((option) => ({ value: option.value, label: option.label?.[language] || option.labelDefault })),
      sortOrder: definition.sortOrder,
    });
  }
  return fields.sort((a, b) => a.sortOrder - b.sortOrder);
}
