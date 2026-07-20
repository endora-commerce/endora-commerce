import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  createCustomFieldDefinitionSchema,
  customFieldOptionSchema,
  supportedEntityTypeSchema,
  updateCustomFieldDefinitionSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { CachedDefinition } from './services/custom-field-definitions-cache.js';
import {
  CustomFieldDefinitionError,
  type CustomFieldDefinitionService,
} from './services/custom-field-definition.service.js';

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
