import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  createCustomFieldDefinitionSchema,
  customFieldOptionSchema,
  supportedEntityTypeSchema,
  updateCustomFieldDefinitionSchema,
  type CustomFieldEntityTypeInfo,
  type SupportedEntityType,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CachedDefinition } from './services/custom-field-definitions-cache.js';
import {
  CustomFieldDefinitionError,
  type CustomFieldDefinitionService,
} from './services/custom-field-definition.service.js';
import {
  isSupportedEntityType,
  SUPPORTED_ENTITIES,
  type SupportedEntityMeta,
} from './services/custom-field-registry.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

export interface CustomFieldsAdminDeps {
  definitionService: CustomFieldDefinitionService;
  requireAdmin: RequireAdminFactory;
}

/** Map a service error to the HTTP envelope. */
function toHttp(err: unknown): never {
  if (err instanceof CustomFieldDefinitionError) {
    switch (err.code) {
      case 'not_found':
        throw new HttpError(404, ERROR_CODES.CUSTOM_FIELD_NOT_FOUND, err.message);
      case 'duplicate_key':
        throw new HttpError(409, ERROR_CODES.CUSTOM_FIELD_KEY_CONFLICT, err.message);
      case 'value_type_locked':
      case 'option_in_use':
        throw new HttpError(409, ERROR_CODES.CUSTOM_FIELD_DEFINITION_INVALID, err.message);
      default:
        throw new HttpError(422, ERROR_CODES.CUSTOM_FIELD_DEFINITION_INVALID, err.message);
    }
  }
  throw err;
}

/**
 * Feature 061 — generic host-managed refusal. When an entity type's registry
 * entry declares `managedBy`, its definitions are mutated only through the
 * owning host module's own surface; the generic mutation routes refuse with
 * 409. Entity-agnostic: only the marker's presence is checked, never which
 * module manages.
 */
function assertNotHostManaged(entityType: string): void {
  const meta = isSupportedEntityType(entityType) ? SUPPORTED_ENTITIES[entityType] : undefined;
  if (meta?.managedBy) {
    throw new HttpError(
      409,
      ERROR_CODES.CUSTOM_FIELD_HOST_MANAGED,
      `Definitions for entity type "${entityType}" are managed by the "${meta.managedBy.moduleId}" module and cannot be modified here.`,
    );
  }
}

function serialize({ definition, options }: CachedDefinition): Record<string, unknown> {
  return {
    id: definition.id,
    entityType: definition.entityType,
    key: definition.key,
    label: definition.label,
    labelDefault: definition.labelDefault,
    valueType: definition.valueType,
    required: definition.required,
    sortOrder: definition.sortOrder,
    config: definition.config,
    options: options.map((o) => ({
      id: o.id,
      value: o.value,
      label: o.label,
      labelDefault: o.labelDefault,
      isDefault: o.isDefault,
      sortOrder: o.sortOrder,
    })),
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}

/**
 * Admin API for custom-field definitions + options (feature 055). All mutations
 * run through the service, which dispatches Commands (Principle XIII). Reads are
 * cached per entity type.
 */
export async function registerCustomFieldsAdminRoutes(
  app: FastifyInstance,
  deps: CustomFieldsAdminDeps,
): Promise<void> {
  const { definitionService, requireAdmin } = deps;

  /** Refuse mutating an existing definition whose entity type is host-managed (feature 061). */
  async function assertDefinitionNotHostManaged(id: string): Promise<void> {
    const def = await definitionService.getById(id);
    if (def) assertNotHostManaged(def.definition.entityType);
  }

  // Feature 061 T037 — supported entity types + host-managed metadata, so the
  // generic admin UI can render managed types read-only with a link to the
  // owning module's surface (no hard-coded entity list in the frontend).
  app.get(
    '/api/v1/admin/custom-fields/entity-types',
    { preHandler: requireAdmin('custom_fields:read') },
    async () => {
      const data: CustomFieldEntityTypeInfo[] = (
        Object.entries(SUPPORTED_ENTITIES) as Array<[SupportedEntityType, SupportedEntityMeta]>
      ).map(([entityType, meta]) => ({
        entityType,
        labelKey: meta.labelKey,
        ...(meta.managedBy
          ? {
              managedBy: {
                moduleId: meta.managedBy.moduleId,
                labelKey: meta.managedBy.labelKey,
                route: meta.managedBy.route,
              },
            }
          : {}),
      }));
      return { data };
    },
  );

  app.get<{ Querystring: { entityType?: string } }>(
    '/api/v1/admin/custom-fields/definitions',
    { preHandler: requireAdmin('custom_fields:read') },
    async (request) => {
      const raw = request.query.entityType;
      const entityType = raw ? supportedEntityTypeSchema.parse(raw) : undefined;
      const defs = await definitionService.listAll(entityType);
      return { data: defs.map(serialize) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/custom-fields/definitions/:id',
    { preHandler: requireAdmin('custom_fields:read') },
    async (request) => {
      const def = await definitionService.getById(request.params.id);
      if (!def) throw new HttpError(404, ERROR_CODES.CUSTOM_FIELD_NOT_FOUND, 'Custom field not found.');
      return { data: serialize(def) };
    },
  );

  app.post(
    '/api/v1/admin/custom-fields/definitions',
    { preHandler: requireAdmin('custom_fields:write'), schema: { body: createCustomFieldDefinitionSchema } },
    async (request, reply) => {
      const body = createCustomFieldDefinitionSchema.parse(request.body);
      assertNotHostManaged(body.entityType);
      try {
        const created = await definitionService.create(body);
        const def = await definitionService.getById(created.id);
        reply.status(201);
        return { data: serialize(def!) };
      } catch (err) {
        toHttp(err);
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/custom-fields/definitions/:id',
    { preHandler: requireAdmin('custom_fields:write'), schema: { body: updateCustomFieldDefinitionSchema } },
    async (request) => {
      const body = updateCustomFieldDefinitionSchema.parse(request.body);
      await assertDefinitionNotHostManaged(request.params.id);
      try {
        const updated = await definitionService.update(request.params.id, body);
        const def = await definitionService.getById(updated.id);
        return { data: serialize(def!) };
      } catch (err) {
        toHttp(err);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/custom-fields/definitions/:id',
    { preHandler: requireAdmin('custom_fields:write') },
    async (request, reply) => {
      await assertDefinitionNotHostManaged(request.params.id);
      try {
        await definitionService.delete(request.params.id);
        reply.status(204);
        return null;
      } catch (err) {
        toHttp(err);
      }
    },
  );

  // ---- Option sub-routes (select / multiselect) ---------------------------

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/custom-fields/definitions/:id/options',
    { preHandler: requireAdmin('custom_fields:write'), schema: { body: customFieldOptionSchema } },
    async (request, reply) => {
      const body = customFieldOptionSchema.parse(request.body);
      await assertDefinitionNotHostManaged(request.params.id);
      try {
        const opt = await definitionService.createOption(request.params.id, body);
        reply.status(201);
        return { data: { id: opt.id, value: opt.value } };
      } catch (err) {
        toHttp(err);
      }
    },
  );

  app.patch<{ Params: { id: string; optionId: string } }>(
    '/api/v1/admin/custom-fields/definitions/:id/options/:optionId',
    { preHandler: requireAdmin('custom_fields:write'), schema: { body: customFieldOptionSchema.partial() } },
    async (request) => {
      const body = customFieldOptionSchema.partial().parse(request.body);
      await assertDefinitionNotHostManaged(request.params.id);
      try {
        const opt = await definitionService.updateOption(request.params.id, request.params.optionId, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.labelDefault !== undefined ? { labelDefault: body.labelDefault } : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        });
        return { data: { id: opt.id, value: opt.value } };
      } catch (err) {
        toHttp(err);
      }
    },
  );

  app.delete<{ Params: { id: string; optionId: string } }>(
    '/api/v1/admin/custom-fields/definitions/:id/options/:optionId',
    { preHandler: requireAdmin('custom_fields:write') },
    async (request, reply) => {
      await assertDefinitionNotHostManaged(request.params.id);
      try {
        await definitionService.deleteOption(request.params.id, request.params.optionId);
        reply.status(204);
        return null;
      } catch (err) {
        toHttp(err);
      }
    },
  );
}
