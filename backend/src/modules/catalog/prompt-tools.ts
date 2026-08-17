import {
  AssignProductsToCategoryParamsSchema,
  RemoveProductsFromCategoryParamsSchema,
  SearchCategoriesParamsSchema,
  SearchProductsParamsSchema,
  SetProductStatusParamsSchema,
  SetProductsVisibilityParamsSchema,
  type AssignProductsToCategoryParams,
  type RemoveProductsFromCategoryParams,
  type SearchCategoriesParams,
  type SearchProductsParams,
  type SetProductStatusParams,
  type SetProductsVisibilityParams,
  type BulkProgressReader,
  type BulkProgressSnapshot,
  type PromptActionTool,
  type ToolContext,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import { HttpError } from '../../http/error-envelope.js';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { Category } from './entities/category.entity.js';
import { Product } from './entities/product.entity.js';
import { CatalogAdminService, type CatalogEventBus } from './services/catalog-admin.service.js';
import { CategoryAdminService } from './services/category-admin.service.js';
import { CatalogBulkUpdateService } from './services/catalog-bulk-update.service.js';
import { BulkOperationService } from './services/bulk-operation.service.js';
import {
  BULK_OPERATION_JOB_NAME,
  createBulkOperationQueue,
} from './services/bulk-operation-queue.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';

/**
 * Catalog's contribution to the prompt-assistant tool catalogue
 * (feature 043, data-model §4): two resolvers plus the US2 bulk
 * category-assignment mutation. Handlers delegate to the same admin
 * services that back the manual admin routes; descriptions are the LLM's
 * only documentation (tool-contribution contract rule 4).
 *
 * The mutation mirrors the feature-022 bulk-update route exactly:
 * ≤ 50 products run synchronously at confirm time; larger selections are
 * enqueued onto the existing durable `catalog.bulk-operation` BullMQ queue
 * (Principle X — this file only adds a second producer over the same
 * queue; the consumer stays catalog's separable worker entrypoint).
 */

export interface CatalogPromptToolsDeps {
  emFactory: () => EntityManager;
  events: EventBus;
  auditLogService?: AuditLogService;
  salesChannelMembership?: SalesChannelMembershipService;
  /** Enables queue delegation for > BULK_ASYNC_THRESHOLD selections. */
  redis?: Redis;
}

/** Mirrors the feature-022 route threshold (catalog/routes.admin.ts). */
const BULK_ASYNC_THRESHOLD = 50;

const RESULT_LIMIT = 20;

function localizedLabel(name: Record<string, string>): string {
  return name['en'] ?? Object.values(name)[0] ?? '(unnamed)';
}

export function catalogPromptResolverTools(deps: CatalogPromptToolsDeps): PromptActionTool[] {
  // Same cast catalog's own plugin performs when constructing this service.
  const adminService = new CatalogAdminService(
    deps.emFactory,
    deps.events as CatalogEventBus,
    deps.auditLogService,
  );
  const categoryService = new CategoryAdminService(deps.emFactory);

  const searchProducts: PromptActionTool<SearchProductsParams> = {
    id: 'catalog.search_products',
    moduleId: 'catalog',
    kind: 'resolver',
    description:
      'Search products by a name, SKU or slug fragment (case- and diacritic-insensitive substring). Returns up to 20 matches as {id, sku, label, status}. Use the returned id in mutation tools; never invent ids.',
    requiredPermission: 'catalog:read',
    paramsSchema: SearchProductsParamsSchema,
    execute: async (params) => {
      const result = await adminService.listProducts({
        q: params.q,
        pageSize: Math.min(params.limit ?? 10, RESULT_LIMIT),
      });
      return result.items.map((p) => ({
        id: p.id,
        sku: p.sku,
        label: localizedLabel(p.name),
        status: p.status,
      }));
    },
  };

  const searchCategories: PromptActionTool<SearchCategoriesParams> = {
    id: 'catalog.search_categories',
    moduleId: 'catalog',
    kind: 'resolver',
    description:
      'Search product categories by a name fragment (case-insensitive). Returns up to 20 matches as {id, label, slug}.',
    requiredPermission: 'catalog:read',
    paramsSchema: SearchCategoriesParamsSchema,
    execute: async (params) => {
      const all = await categoryService.listAll();
      const needle = params.q.toLowerCase();
      return all
        .filter((c) => {
          const labels = Object.values(c.name).join(' ').toLowerCase();
          return labels.includes(needle) || c.slug.toLowerCase().includes(needle);
        })
        .slice(0, RESULT_LIMIT)
        .map((c) => ({ id: c.id, label: localizedLabel(c.name), slug: c.slug }));
    },
  };

  return [searchProducts as PromptActionTool, searchCategories as PromptActionTool];
}

// ---------------------------------------------------------------------------
// US2 — bulk category assignment (mutation) + delegated-progress resolver
// ---------------------------------------------------------------------------

function buildBulkServices(deps: CatalogPromptToolsDeps): {
  bulkOperationService: BulkOperationService;
  bulkUpdateService: CatalogBulkUpdateService;
} {
  const adminService = new CatalogAdminService(
    deps.emFactory,
    deps.events as CatalogEventBus,
    deps.auditLogService,
    deps.salesChannelMembership,
  );
  const bulkUpdateService = new CatalogBulkUpdateService(
    deps.emFactory,
    adminService,
    deps.salesChannelMembership,
    deps.auditLogService,
  );
  const queue = deps.redis ? createBulkOperationQueue(deps.redis) : undefined;
  const bulkOperationService = new BulkOperationService(deps.emFactory, bulkUpdateService, {
    ...(queue
      ? {
          onEnqueued: async (operationId: string): Promise<void> => {
            await queue.add(BULK_OPERATION_JOB_NAME, { operationId });
          },
        }
      : {}),
  });
  return { bulkOperationService, bulkUpdateService };
}

/** Shared bulk-fields execution: ≤ threshold runs sync; larger delegates to the queue. */
async function runBulkFieldsUpdate(
  services: { bulkOperationService: BulkOperationService; bulkUpdateService: CatalogBulkUpdateService },
  fields: Record<string, unknown>,
  productIds: string[],
  ctx: ToolContext,
): Promise<unknown> {
  const request = { productIds, fields };
  if (productIds.length > BULK_ASYNC_THRESHOLD) {
    const op = await services.bulkOperationService.create({
      requestedByAdminUserId: ctx.adminUserId,
      payload: request,
    });
    return { delegated: true, bulkOperationId: op.id };
  }
  const result = await services.bulkUpdateService.bulkUpdate(request, {
    actorAdminUserId: ctx.adminUserId,
    impersonatedCustomerAccountId: null,
    ipAddress: ctx.auditCtx.ipAddress ?? null,
    userAgent: ctx.auditCtx.userAgent ?? null,
    requestId: ctx.auditCtx.requestId ?? null,
  });
  return {
    summary: {
      total: result.summary.total,
      succeeded: result.summary.succeeded,
      failed: result.summary.failed + result.summary.skipped,
      failures: result.results
        .filter((r) => r.status !== 'succeeded')
        .slice(0, 50)
        .map((r) => ({ id: r.productId, reason: r.details?.message ?? r.reason ?? 'failed' })),
    },
  };
}

/** Shared preview: validate all ids exist and build the affected-count + sample. */
async function previewProducts(
  em: EntityManager,
  productIds: string[],
  headline: string,
): Promise<{ headline: string; affectedCount: number; sample: Array<{ id: string; label: string }> }> {
  const products = await em.find(Product, { id: { $in: productIds } }, { fields: ['id', 'name', 'sku'] });
  if (products.length !== productIds.length) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'One or more products were not found.');
  }
  return {
    headline,
    affectedCount: products.length,
    sample: products.slice(0, 10).map((p) => ({ id: p.id, label: localizedLabel(p.name) })),
  };
}

export function catalogPromptMutationTools(deps: CatalogPromptToolsDeps): PromptActionTool[] {
  const services = buildBulkServices(deps);
  const { bulkOperationService, bulkUpdateService } = services;

  const assignToCategory: PromptActionTool<AssignProductsToCategoryParams> = {
    id: 'catalog.assign_products_to_category',
    moduleId: 'catalog',
    kind: 'mutation',
    description:
      'Assign one or more products to a category (additive — existing category assignments are kept). Resolve products via catalog.search_products and the category via catalog.search_categories first. Captured into a plan the operator must confirm; not executed immediately.',
    requiredPermission: 'catalog:write',
    paramsSchema: AssignProductsToCategoryParamsSchema,
    preview: async (params) => {
      // D-75 — this module's own fork, not the caller's manager. A preview
      // reads committed rows: the request row it would have shared a unit of
      // work with is flushed before the interpreter runs, and nothing here
      // writes.
      const em = deps.emFactory();
      const category = await em.findOne(Category, { id: params.categoryId, deletedAt: null });
      if (!category) throw new HttpError(404, 'NOT_FOUND', 'Category not found.');
      // The preview runs the same membership query execution will use: the
      // ids are validated to exist so the affected count is honest (FR-004).
      const products = await em.find(
        Product,
        { id: { $in: params.productIds } },
        { fields: ['id', 'name', 'sku'] },
      );
      if (products.length !== params.productIds.length) {
        throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'One or more products were not found.');
      }
      const label = category.name['en'] ?? Object.values(category.name)[0] ?? category.slug;
      return {
        headline: `Assign ${products.length} product(s) to category "${label}"`,
        affectedCount: products.length,
        sample: products.slice(0, 10).map((p) => ({
          id: p.id,
          label: p.name['en'] ?? Object.values(p.name)[0] ?? p.sku,
        })),
      };
    },
    execute: async (params, ctx: ToolContext) => {
      const request = {
        productIds: params.productIds,
        fields: { categories: { mode: 'add' as const, categoryIds: [params.categoryId] } },
      };
      if (params.productIds.length > BULK_ASYNC_THRESHOLD) {
        const op = await bulkOperationService.create({
          requestedByAdminUserId: ctx.adminUserId,
          payload: request,
        });
        return { delegated: true, bulkOperationId: op.id };
      }
      const result = await bulkUpdateService.bulkUpdate(request, {
        actorAdminUserId: ctx.adminUserId,
        impersonatedCustomerAccountId: null,
        ipAddress: ctx.auditCtx.ipAddress ?? null,
        userAgent: ctx.auditCtx.userAgent ?? null,
        requestId: ctx.auditCtx.requestId ?? null,
      });
      return {
        summary: {
          total: result.summary.total,
          succeeded: result.summary.succeeded,
          failed: result.summary.failed + result.summary.skipped,
          failures: result.results
            .filter((r) => r.status !== 'succeeded')
            .slice(0, 50)
            .map((r) => ({
              id: r.productId,
              reason: r.details?.message ?? r.reason ?? 'failed',
            })),
        },
      };
    },
  };

  const removeFromCategory: PromptActionTool<RemoveProductsFromCategoryParams> = {
    id: 'catalog.remove_products_from_category',
    moduleId: 'catalog',
    kind: 'mutation',
    description:
      'Remove one or more products from a category (subtractive — only the named category is removed, other category assignments are kept). Resolve products via catalog.search_products and the category via catalog.search_categories first. Captured into a plan the operator must confirm; not executed immediately.',
    requiredPermission: 'catalog:write',
    paramsSchema: RemoveProductsFromCategoryParamsSchema,
    preview: async (params) => {
      // D-75 — this module's own fork, not the caller's manager. A preview
      // reads committed rows: the request row it would have shared a unit of
      // work with is flushed before the interpreter runs, and nothing here
      // writes.
      const em = deps.emFactory();
      const category = await em.findOne(Category, { id: params.categoryId, deletedAt: null });
      if (!category) throw new HttpError(404, 'NOT_FOUND', 'Category not found.');
      const products = await em.find(
        Product,
        { id: { $in: params.productIds } },
        { fields: ['id', 'name', 'sku'] },
      );
      if (products.length !== params.productIds.length) {
        throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'One or more products were not found.');
      }
      const label = category.name['en'] ?? Object.values(category.name)[0] ?? category.slug;
      return {
        headline: `Remove ${products.length} product(s) from category "${label}"`,
        affectedCount: products.length,
        sample: products.slice(0, 10).map((p) => ({
          id: p.id,
          label: p.name['en'] ?? Object.values(p.name)[0] ?? p.sku,
        })),
      };
    },
    execute: async (params, ctx: ToolContext) =>
      runBulkFieldsUpdate(
        services,
        { categories: { mode: 'remove' as const, categoryIds: [params.categoryId] } },
        params.productIds,
        ctx,
      ),
  };

  const setProductStatus: PromptActionTool<SetProductStatusParams> = {
    id: 'catalog.set_product_status',
    moduleId: 'catalog',
    kind: 'mutation',
    description:
      'Set the status (draft | active | inactive) of one or more products. Resolve products via catalog.search_products first. Captured into a plan the operator must confirm; not executed immediately.',
    requiredPermission: 'catalog:write',
    paramsSchema: SetProductStatusParamsSchema,
    preview: async (params) =>
      previewProducts(
        deps.emFactory(),
        params.productIds,
        `Set status of ${params.productIds.length} product(s) to "${params.status}"`,
      ),
    execute: async (params, ctx: ToolContext) =>
      runBulkFieldsUpdate(services, { status: params.status }, params.productIds, ctx),
  };

  const setProductsVisibility: PromptActionTool<SetProductsVisibilityParams> = {
    id: 'catalog.set_products_visibility',
    moduleId: 'catalog',
    kind: 'mutation',
    description:
      'Set the storefront visibility (public | logged_in_only | organization_restricted) of one or more products as a bulk action. Resolve products via catalog.search_products first. Captured into a plan the operator must confirm; not executed immediately.',
    requiredPermission: 'catalog:write',
    paramsSchema: SetProductsVisibilityParamsSchema,
    preview: async (params) =>
      previewProducts(
        deps.emFactory(),
        params.productIds,
        `Set visibility of ${params.productIds.length} product(s) to "${params.visibility}"`,
      ),
    execute: async (params, ctx: ToolContext) =>
      runBulkFieldsUpdate(services, { visibility: params.visibility }, params.productIds, ctx),
  };

  return [
    assignToCategory as PromptActionTool,
    removeFromCategory as PromptActionTool,
    setProductStatus as PromptActionTool,
    setProductsVisibility as PromptActionTool,
  ];
}

/**
 * Live `catalog_bulk_operations` progress for one delegated prompt request
 * (research §R6, FR-011/FR-018), contributed as `prompt_actions`'
 * `BulkProgressReader`.
 *
 * D-76 — data out, and nothing else. This used to take
 * `(row: PromptActionRequest, em: EntityManager)` and write `row.result`,
 * `row.status` and `row.error` on `prompt_actions`' own entity, which put that
 * module's state machine in this module's hands; the `em` was never bound at
 * all. What a bulk operation did is this module's fact, and this returns
 * exactly that fact — whether the request is `completed`, `failed` or
 * `completed_with_errors` is decided by its owner.
 *
 * `null` means "not one of mine": the id names no bulk operation here, so the
 * host may ask the next contributor.
 */
export function catalogBulkProgressReader(deps: CatalogPromptToolsDeps): BulkProgressReader {
  const { bulkOperationService } = buildBulkServices(deps);
  return async (bulkOperationId): Promise<BulkProgressSnapshot | null> => {
    const op = await bulkOperationService.get(bulkOperationId);
    if (!op) return null;
    return {
      total: op.total,
      succeeded: op.succeeded,
      failed: op.failed + op.skipped,
      failures: (op.results ?? [])
        .filter((r) => r.status !== 'succeeded')
        .slice(0, 50)
        .map((r) => ({ id: r.productId, reason: r.details?.message ?? r.reason ?? 'failed' })),
      terminal: op.status === 'completed' || op.status === 'failed' ? op.status : null,
      error: op.error ?? null,
    };
  };
}
