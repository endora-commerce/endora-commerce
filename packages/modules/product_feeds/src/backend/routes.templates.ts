import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createFeedTemplateRequestSchema,
  duplicateFeedTemplateRequestSchema,
  feedTemplatePreviewRequestSchema,
  updateFeedTemplateRequestSchema,
} from '@endora-commerce/contracts';
import { PRODUCT_FEEDS_READ_PERMISSION, PRODUCT_FEEDS_WRITE_PERMISSION } from '../manifest.js';
import { parseOrThrow } from './routes.admin.js';
import type { FeedTemplateService, TemplateView } from './services/feed-template.service.js';
import {
  parseImportRequest,
  type FeedTemplateIoService,
} from './services/feed-template-io.service.js';
import {
  buildFieldSourceCatalogue,
  type ProductFieldDefinition,
} from './services/field-source-catalogue.js';
import type { TemplatePreviewService } from './services/template-preview.service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Feed template admin surface — feature 067 (contracts/admin-templates.md §1).
 *
 *   GET    /api/v1/admin/feed-templates
 *   GET    /api/v1/admin/feed-templates/field-sources
 *   POST   /api/v1/admin/feed-templates/import
 *   GET    /api/v1/admin/feed-templates/:id
 *   GET    /api/v1/admin/feed-templates/:id/export
 *   POST   /api/v1/admin/feed-templates
 *   PUT    /api/v1/admin/feed-templates/:id
 *   POST   /api/v1/admin/feed-templates/:id/duplicate
 *   DELETE /api/v1/admin/feed-templates/:id
 *   POST   /api/v1/admin/feed-previews/template
 *
 * `/field-sources` and `/import` are declared as static segments alongside
 * `/:id`; Fastify's router matches static segments first, so they never race.
 *
 * The preview lives on the `feed-previews` namespace, not under
 * `/feed-templates/:id/preview`, because it evaluates the **unsaved draft** —
 * there may be no `:id` yet, and forcing a save of a broken intermediate state
 * to see a value is exactly what SC-013 cannot afford.
 *
 * Every async handler `return`s its reply. `inject()` masks a missing return;
 * over a real socket the same handler crash-loops with `ERR_HTTP_HEADERS_SENT`.
 */

export interface ProductFeedsTemplateRoutesDeps {
  requireAdmin: RequireAdminFactory;
  templates: FeedTemplateService;
  /** Export/import of the portability document (FR-012 – FR-018). */
  io: FeedTemplateIoService;
  preview: TemplatePreviewService;
  /** Product-host attributes and custom fields — one registry since feature 061. */
  listProductFieldDefinitions: () => Promise<ProductFieldDefinition[]>;
}

/**
 * Ceiling on the import body, applied by Fastify **before** the JSON is parsed.
 *
 * An import is the module's only route that accepts a file an operator was
 * handed by someone else. A 200-field template serializes to roughly 40 kB, so
 * 512 kB is generous by an order of magnitude while still refusing a file
 * designed to make the parser the attack. The contract's `.max(200)` on the
 * field list is the second half of the same guard.
 */
const IMPORT_BODY_LIMIT_BYTES = 512 * 1024;

const idParamsSchema = z.object({ id: z.string().uuid() });

/** `W/"<id>:<version>"`, and tolerant of a bare `"<version>"` (Postel). */
export function parseTemplateIfMatch(request: FastifyRequest): number | null {
  const header = request.headers['if-match'];
  if (!header || typeof header !== 'string') return null;
  const tag = header.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
  const version = tag.includes(':') ? tag.slice(tag.lastIndexOf(':') + 1) : tag;
  const parsed = Number.parseInt(version, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFieldDto(field: TemplateView['fields'][number]): Record<string, unknown> {
  return {
    id: field.id,
    outputName: field.outputName,
    sourceKind: field.sourceKind,
    sourceKey: field.sourceKey ?? null,
    constantValue: field.constantValue ?? null,
    fallbackValue: field.fallbackValue ?? null,
    providerRequired: field.providerRequired,
    transform: field.transform ?? null,
    transformArg: field.transformArg ?? null,
    sortOrder: field.sortOrder,
    helpKey: field.helpKey ?? null,
    unbound: field.unbound,
  };
}

export function toTemplateDto(
  view: TemplateView,
  options: { includeFields: boolean },
): Record<string, unknown> {
  const { template } = view;
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    providerCode: template.providerCode,
    outputFormat: template.outputFormat,
    itemGranularity: template.itemGranularity,
    taxonomyProviderCode: view.taxonomyProviderCode,
    isSystem: template.isSystem,
    systemCode: template.systemCode ?? null,
    usedByFeedCount: view.usedByFeedCount,
    // Kept alongside `fields` for the list view, which shows a count and never
    // the list itself (`ux-design` §2.5).
    fieldCount: view.fields.length,
    version: template.version,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    ...(options.includeFields ? { fields: view.fields.map(toFieldDto) } : {}),
  };
}

export async function registerProductFeedsTemplateRoutes(
  app: FastifyInstance,
  deps: ProductFeedsTemplateRoutesDeps,
): Promise<void> {
  const read = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION) };
  const write = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_WRITE_PERMISSION) };

  app.get('/api/v1/admin/feed-templates', read, async (_request, reply) => {
    const views = await deps.templates.list();
    return reply.send({ data: views.map((view) => toTemplateDto(view, { includeFields: false })) });
  });

  // FR-070 — the operator picks from what exists here; they never type a key.
  app.get('/api/v1/admin/feed-templates/field-sources', read, async (_request, reply) => {
    const definitions = await deps.listProductFieldDefinitions();
    return reply.send({ data: buildFieldSourceCatalogue(definitions) });
  });

  // ---------------------------------------------------------------------------
  // Portability (FR-012 – FR-018, contracts/template-portability.md)
  // ---------------------------------------------------------------------------

  app.post(
    '/api/v1/admin/feed-templates/import',
    { ...write, bodyLimit: IMPORT_BODY_LIMIT_BYTES },
    async (request, reply) => {
      // Shape, field-count ceiling and `formatVersion` are checked here, before
      // the service reads anything: `formatVersion` is a literal in the schema,
      // so an unknown version is refused rather than dispatched on.
      const parsed = parseImportRequest(request.body ?? {});
      const { view, unresolvedBindings } = await deps.io.importDocument(parsed);
      return reply.status(201).send({
        data: {
          template: toTemplateDto(view, { includeFields: true }),
          unresolvedBindings,
        },
      });
    },
  );

  app.get('/api/v1/admin/feed-templates/:id/export', read, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const { body, filename } = await deps.io.exportDocument(id);
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      // The document carries the field list of a template, not prices, but it
      // is still shop configuration: no intermediary may cache it.
      .header('Cache-Control', 'private, no-store')
      .send(body);
  });

  app.get('/api/v1/admin/feed-templates/:id', read, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const view = await deps.templates.view(id);
    return reply
      .header('etag', `W/"${view.template.id}:${view.template.version}"`)
      .send({ data: toTemplateDto(view, { includeFields: true }) });
  });

  app.post('/api/v1/admin/feed-templates', write, async (request, reply) => {
    const body = parseOrThrow(createFeedTemplateRequestSchema, request.body ?? {});
    const view = await deps.templates.create(body);
    return reply.status(201).send({ data: toTemplateDto(view, { includeFields: true }) });
  });

  app.put('/api/v1/admin/feed-templates/:id', write, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const body = parseOrThrow(updateFeedTemplateRequestSchema, request.body ?? {});
    const query = (request.query ?? {}) as Record<string, unknown>;
    const { view, warnings } = await deps.templates.update(id, body, {
      expectedVersion: parseTemplateIfMatch(request),
      // FR-074: the operator has seen the consequence and asked for it anyway.
      acknowledgeWarnings: query['acknowledgeWarnings'] === 'true',
    });
    return reply
      .header('etag', `W/"${view.template.id}:${view.template.version}"`)
      .send({ data: toTemplateDto(view, { includeFields: true }), warnings });
  });

  app.post('/api/v1/admin/feed-templates/:id/duplicate', write, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const body = parseOrThrow(duplicateFeedTemplateRequestSchema, request.body ?? {});
    const view = await deps.templates.duplicate(id, body.name);
    return reply.status(201).send({ data: toTemplateDto(view, { includeFields: true }) });
  });

  app.delete('/api/v1/admin/feed-templates/:id', write, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    await deps.templates.delete(id, parseTemplateIfMatch(request));
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Draft evaluation — the sample-product preview (FR-072)
  //
  // Needs `catalog:read` **in addition to** `product_feeds:read`: it renders
  // product data and resolved prices, so the caller must hold the permission
  // that gates reading the catalogue. Runs under the caller's ordinary ambient
  // TenantContext — never `withSystemScope` — and writes nothing at all.
  // ---------------------------------------------------------------------------

  app.post(
    '/api/v1/admin/feed-previews/template',
    {
      preHandler: [
        deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION),
        deps.requireAdmin('catalog:read'),
      ],
    },
    async (request, reply) => {
      const body = parseOrThrow(feedTemplatePreviewRequestSchema, request.body ?? {});
      const result = await deps.preview.preview(body);
      return reply.header('Cache-Control', 'private, no-store').send({ data: result });
    },
  );
}
