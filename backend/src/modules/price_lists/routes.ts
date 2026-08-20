import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createPriceListEngineRequestSchema,
  patchPriceListEngineRequestSchema,
  replaceBracketsRequestSchema,
  replaceProductsRequestSchema,
  ERROR_CODES,
} from '@b2b/contracts';
import { z } from 'zod';
import { HttpError } from '../../http/error-envelope.js';
import type { ApplicationRule } from '@b2b/contracts';
import { ruleVisibleForScope } from '../../tenancy/derived-scope.js';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';
import type { PriceList } from './entities/price-list.entity.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '../../kernel/sales-channels/sales-channel.entity.js';
import type {
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomerGroupReadPort,
  OrganizationDetailsPort,
} from '@b2b/contracts';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { PRICE_LIST_PERMISSIONS } from './manifest.js';

export interface PricingRoutesDeps {
  priceListService: PriceListService;
  pricingService: PricingServiceContract;
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /**
   * Feature 075 Phase C — the neighbour reads these admin screens make. The
   * rule-target pickers list organisations and categories; the product pricing
   * panel and the resolved-price probe resolve a product. All three used to be
   * `em.find` against tables this module does not own; each fails closed at the
   * seam now, which is the right answer for an admin screen that would
   * otherwise offer targets the platform cannot serve.
   */
  catalogProductRead: CatalogProductReadPort;
  catalogCategoryRead: CatalogCategoryReadPort;
  organizationDetails: OrganizationDetailsPort;
  /**
   * Feature 076 (D-79) — the last two neighbour reads this module made by
   * importing another module's entity, both of them into `customer_accounts`.
   * The rule-target picker lists customer groups; the admin resolved-price
   * probe reads the customer behind the price it is asked to explain. Both fail
   * closed at the seam, which is the right answer for a probe that would
   * otherwise price for a customer the platform will not identify.
   */
  customerGroupRead: CustomerGroupReadPort;
  customerAccountRead: CustomerAccountReadPort;
  /** Feature 024 — resolves admin actor identity for audit entries. */
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
}

function buildAuditCtx(
  request: FastifyRequest,
  resolver:
    | ((req: FastifyRequest) => { actorAdminUserId: string; impersonatedCustomerAccountId?: string | null })
    | undefined,
) {
  const base = resolver?.(request);
  if (!base) return undefined;
  return {
    actorAdminUserId: base.actorAdminUserId,
    impersonatedCustomerAccountId: base.impersonatedCustomerAccountId ?? null,
    ipAddress: request.ip ?? null,
    userAgent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : null,
    requestId: request.id,
  };
}

/**
 * Feature 050 — price_lists is rule-scoped: its org targeting lives in the
 * applicationRule AST, not a column. Collect the org ids a rule targets so a
 * scoped admin only sees lists targeting one of their orgs (or global lists).
 */
function extractRuleOrgTargets(rule: ApplicationRule | null | undefined): string[] {
  if (!rule) return [];
  switch (rule.kind) {
    case 'all':
      return [];
    case 'criterion':
      return rule.type === 'organization' ? [...rule.values] : [];
    case 'group':
      return rule.children.flatMap(extractRuleOrgTargets);
  }
}

export async function registerPricingRoutes(
  app: FastifyInstance,
  deps: PricingRoutesDeps,
): Promise<void> {
  const {
    priceListService,
    pricingService,
    emFactory,
    requireAdmin,
    catalogProductRead,
    catalogCategoryRead,
    organizationDetails,
    customerGroupRead,
    customerAccountRead,
  } = deps;

  /**
   * Issue #219 — this module's own gates. Every route below used to name
   * `catalog:write`, which bought the ability to change what customers pay with
   * a permission granted for content work. The split is by what the route does:
   * a listing or a picker is `price_lists:read`, anything that persists is
   * `price_lists:write`.
   *
   * No compatibility shim: `catalog:write` is refused here now, so a role that
   * needs pricing is granted a pricing code deliberately. See the first-
   * deployment checklist item D3.
   */
  const readGate = requireAdmin(PRICE_LIST_PERMISSIONS.READ);
  const writeGate = requireAdmin(PRICE_LIST_PERMISSIONS.WRITE);

  // ---- Engine routes (feature 011) -----------------------------------

  app.get<{
    Querystring: {
      status?: string | string[];
      type?: string | string[];
      search?: string;
    };
  }>(
    '/api/v1/admin/price-lists-engine',
    { preHandler: readGate },
    async (request) => {
      const status = toArray(request.query.status).filter((s): s is 'draft' | 'active' | 'scheduled' | 'expired' =>
        s === 'draft' || s === 'active' || s === 'scheduled' || s === 'expired',
      );
      const type = toArray(request.query.type).filter((t): t is 'base' | 'sale' => t === 'base' || t === 'sale');
      const filter: Parameters<PriceListService['listEngine']>[0] = {};
      if (status.length > 0) filter.status = status;
      if (type.length > 0) filter.type = type;
      if (typeof request.query.search === 'string' && request.query.search.trim().length > 0) {
        filter.search = request.query.search.trim();
      }
      const rows = await priceListService.listEngine(filter);
      // Feature 050 — hide price lists that target only orgs outside the scope.
      const scoped = rows.filter((r) => ruleVisibleForScope(extractRuleOrgTargets(r.applicationRule)));
      return { data: { items: scoped.map(serializePriceListEngine) } };
    },
  );

  app.post(
    '/api/v1/admin/price-lists-engine',
    {
      preHandler: writeGate,
      schema: { body: createPriceListEngineRequestSchema },
    },
    async (request, reply) => {
      const body = createPriceListEngineRequestSchema.parse(request.body);
      const row = await priceListService.create(
        {
          name: body.name,
          type: body.type,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          ...(body.applicationRule !== undefined ? { applicationRule: body.applicationRule } : {}),
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      reply.status(201);
      return { data: serializePriceListEngine(row) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    {
      preHandler: writeGate,
      schema: { body: patchPriceListEngineRequestSchema },
    },
    async (request) => {
      const body = patchPriceListEngineRequestSchema.parse(request.body);
      const patch: Parameters<PriceListService['patch']>[1] = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.type !== undefined) patch.type = body.type;
      if (body.startsAt !== undefined) patch.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.endsAt !== undefined) patch.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.applicationRule !== undefined) patch.applicationRule = body.applicationRule;
      const row = await priceListService.patch(
        request.params.id,
        patch,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    { preHandler: readGate },
    async (request) => {
      const row = await priceListService.getById(request.params.id);
      if (!ruleVisibleForScope(extractRuleOrgTargets(row.applicationRule))) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Price list ${request.params.id} not found.`);
      }
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/activate',
    { preHandler: writeGate },
    async (request) => {
      const row = await priceListService.activate(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/draftify',
    { preHandler: writeGate },
    async (request) => {
      const row = await priceListService.draftify(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/duplicate',
    { preHandler: writeGate },
    async (request, reply) => {
      const dup = await priceListService.duplicate(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      reply.status(201);
      return { data: serializePriceListEngine(dup) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    { preHandler: writeGate },
    async (request, reply) => {
      await priceListService.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  // ---- Engine: product roster + bracket pricing (US3) ----------------

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    { preHandler: readGate },
    async (request) => {
      const items = await priceListService.listProducts(request.params.id);
      return { data: { items } };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    {
      preHandler: writeGate,
      schema: { body: replaceProductsRequestSchema },
    },
    async (request) => {
      const body = replaceProductsRequestSchema.parse(request.body);
      const result = await priceListService.replaceProducts(
        request.params.id,
        body.productIds,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    {
      preHandler: writeGate,
      schema: { body: z.object({ productId: z.string().uuid() }) },
    },
    async (request, reply) => {
      const body = z.object({ productId: z.string().uuid() }).parse(request.body);
      await priceListService.addProduct(request.params.id, body.productId);
      reply.status(201);
      return { data: { priceListId: request.params.id, productId: body.productId } };
    },
  );

  app.delete<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId',
    { preHandler: writeGate },
    async (request, reply) => {
      await priceListService.removeProduct(request.params.id, request.params.productId);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets',
    { preHandler: readGate },
    async (request) => {
      const list = await priceListService.listProducts(request.params.id);
      const entry = list.find((e) => e.productId === request.params.productId);
      if (!entry) {
        return { data: { bracketsByCurrency: {} } };
      }
      return { data: { bracketsByCurrency: entry.bracketsByCurrency } };
    },
  );

  app.put<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets',
    {
      preHandler: writeGate,
      schema: { body: replaceBracketsRequestSchema },
    },
    async (request) => {
      const body = replaceBracketsRequestSchema.parse(request.body);
      const out = await priceListService.replaceBrackets(
        request.params.id,
        request.params.productId,
        body.bracketsByCurrency,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: { bracketsByCurrency: out } };
    },
  );

  app.post<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy',
    {
      preHandler: writeGate,
      schema: {
        body: z.object({
          fromCurrency: z.string().regex(/^[A-Z]{3}$/),
          toCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
        }),
      },
    },
    async (request) => {
      const body = z
        .object({
          fromCurrency: z.string().regex(/^[A-Z]{3}$/),
          toCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
        })
        .parse(request.body);
      const result = await priceListService.copyCurrencyBrackets(
        request.params.id,
        request.params.productId,
        body.fromCurrency,
        body.toCurrencies,
      );
      return { data: result };
    },
  );

  // ---- Rule-builder pickers (US4) -----------------------------------

  app.get(
    '/api/v1/admin/pricing/rule-targets/sales-channels',
    { preHandler: readGate },
    async () => {
      const em = emFactory();
      const rows = await em.find(SalesChannel, {}, { orderBy: { code: 'asc' } });
      return {
        data: {
          items: rows.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
          })),
        },
      };
    },
  );

  /**
   * Issue #180 removed `catalog:write` from the canonical customer-group
   * endpoints and missed this copy — a pricing rule-target picker, not a
   * catalogue surface. The `promotions` and `pwa` twins have always answered
   * behind their own module's read code; so does this one now.
   */
  app.get(
    '/api/v1/admin/pricing/rule-targets/customer-groups',
    { preHandler: readGate },
    async () => {
      // Already ordered by code on the owner's side.
      const rows = await customerGroupRead.listAll();
      return {
        data: {
          items: rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        },
      };
    },
  );

  app.get<{ Querystring: { search?: string; limit?: string } }>(
    '/api/v1/admin/pricing/rule-targets/organizations',
    { preHandler: readGate },
    async (request) => {
      const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? '50')));
      const search = (request.query.search ?? '').trim();
      // `searchByName` matches the diacritic-folded `nameSearch` column, where
      // this picker used to `$ilike` on `name` — so a search for "lodz" now
      // finds "Łódź" here as it already did on the order list.
      const rows = await organizationDetails.searchByName(search, limit);
      return {
        data: {
          items: rows.map((r) => ({ id: r.id, name: r.name, taxId: r.taxId })),
          nextCursor: null,
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/categories',
    { preHandler: readGate },
    async () => {
      // The port's `listAll` is already ordered by sort order then slug.
      const rows = await catalogCategoryRead.listAll();
      return {
        data: {
          items: rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            parentCategoryId: r.parentCategoryId ?? null,
            sortOrder: r.sortOrder,
          })),
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/currencies',
    { preHandler: readGate },
    async () => {
      const em = emFactory();
      const channels = await em.find(SalesChannel, {});
      const exposed = new Map<string, string[]>();
      for (const ch of channels) {
        for (const cur of ch.currencies ?? []) {
          if (typeof cur !== 'string' || cur.length !== 3) continue;
          const key = cur.toUpperCase();
          const list = exposed.get(key) ?? [];
          list.push(ch.code);
          exposed.set(key, list);
        }
      }
      const items = [...exposed.entries()]
        .map(([code, exposedByChannels]) => ({ code, exposedByChannels }))
        .sort((a, b) => a.code.localeCompare(b.code));
      return { data: { items } };
    },
  );

  // ---- Linked price-lists panel for the product editor (US8) -------

  app.get<{ Params: { productId: string } }>(
    '/api/v1/admin/products/:productId/price-lists',
    { preHandler: readGate },
    async (request, reply) => {
      const product = await catalogProductRead.findById(request.params.productId);
      if (!product) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      const items = await priceListService.summarizeBracketsForProduct(
        request.params.productId,
      );
      return {
        data: {
          items: items.map((it) => ({
            list: {
              id: it.list.id,
              name: it.list.name,
              type: it.list.type,
              status: it.list.status,
              modifiedAt: it.list.modifiedAt.toISOString(),
            },
            summary: it.summary,
            deepLinkPath: it.deepLinkPath,
          })),
        },
      };
    },
  );

  // ---- Display-mode overrides (US7) ----------------------------------

  app.get<{ Querystring: { scope?: 'organization' | 'category' | 'product' } }>(
    '/api/v1/admin/pricing/display-mode-overrides',
    { preHandler: readGate },
    async (request) => {
      const items = await priceListService.listDisplayModeOverrides(request.query.scope);
      return {
        data: {
          items: items.map((o) => ({
            scope: o.scope,
            targetId: o.targetId,
            mode: o.mode,
            updatedAt: o.updatedAt.toISOString(),
          })),
        },
      };
    },
  );

  app.get<{
    Params: { scope: 'organization' | 'category' | 'product'; targetId: string };
  }>(
    '/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId',
    { preHandler: readGate },
    async (request, reply) => {
      const row = await priceListService.getDisplayModeOverride(
        request.params.scope,
        request.params.targetId,
      );
      if (!row) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Override not found.' } };
      }
      return {
        data: {
          scope: row.scope,
          targetId: row.targetId,
          mode: row.mode,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  );

  app.put<{
    Params: { scope: 'organization' | 'category' | 'product'; targetId: string };
  }>(
    '/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId',
    {
      preHandler: writeGate,
      schema: {
        body: z.object({
          mode: z.enum(['gross_only', 'net_only', 'both', 'none', 'inherit']),
        }),
      },
    },
    async (request, reply) => {
      const body = z
        .object({ mode: z.enum(['gross_only', 'net_only', 'both', 'none', 'inherit']) })
        .parse(request.body);
      const row = await priceListService.upsertDisplayModeOverride(
        request.params.scope,
        request.params.targetId,
        body.mode,
      );
      if (!row) {
        return reply.status(204).send();
      }
      return {
        data: {
          scope: row.scope,
          targetId: row.targetId,
          mode: row.mode,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  );

  // Storefront-public routes live in `routes.storefront.ts` and are mounted
  // separately from `plugin.ts` so the admin and storefront surfaces stay
  // independently auditable. See T025/T026.

  // Test-only sweeper hook — the production code path runs the worker on the
  // BullMQ queue every 5 min. This endpoint lets integration tests advance
  // the state machine without waiting for the queue tick.
  app.post(
    '/api/v1/admin/price-lists-engine/internal/sweep',
    { preHandler: writeGate },
    async () => {
      // The worker reads/writes through the same EM as the rest of the
      // module; constructed here so the route doesn't pin the worker to
      // the module-level construction.
      const { PriceListStatusWorker } = await import('./services/price-list-status-worker.js');
      const worker = new PriceListStatusWorker(emFactory);
      const result = await worker.sweep();
      return { data: result };
    },
  );

  // ---- Admin price resolution for a specific customer -----------------
  // Resolves the effective unit price for a (product, customer/organization)
  // pair so admin-side flows (notably "create quote request on behalf of a
  // customer") can pre-fill the agreed unit price from the customer's price
  // lists instead of leaving the field blank. Mirrors the storefront resolver
  // but threads the customer's organization + group context.
  app.get<{
    Params: { id: string };
    Querystring: {
      organizationId?: string;
      customerAccountId?: string;
      quantity?: string;
      currency?: string;
      variantId?: string;
    };
  }>(
    '/api/v1/admin/products/:id/resolved-price',
    { preHandler: requireAdmin('rfqs:handle') },
    async (request, reply) => {
      const em = emFactory();
      const product = await catalogProductRead.findById(request.params.id);
      if (!product) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Product not found.' } });
      }

      const customer = request.query.customerAccountId
        ? await customerAccountRead.findById(request.query.customerAccountId)
        : null;
      const organizationId = request.query.organizationId ?? customer?.organizationId ?? null;
      const organization = organizationId
        ? await organizationDetails.findById(organizationId)
        : null;

      const salesChannel = await em.findOne(SalesChannel, { systemDefault: true });
      if (!salesChannel) {
        return reply
          .status(400)
          .send({ error: { code: 'VALIDATION_FAILED', message: 'No default sales channel.' } });
      }

      const quantity = Math.max(1, Number(request.query.quantity ?? '1') || 1);
      const currency = request.query.currency?.toUpperCase() ?? salesChannel.defaultCurrency;
      const customerGroupId =
        customer?.customerGroupId ?? organization?.customerGroupId ?? null;

      const resolved = await pricingService.resolveLinePrice({
        product,
        variantId: request.query.variantId ?? null,
        context: {
          quantity,
          organization: organization ?? null,
          customerGroupId,
          salesChannel,
          currencyCode: currency,
        },
      });

      return {
        data: {
          resolvedPrice: resolved
            ? {
                amount: resolved.amount,
                currency: resolved.currency,
                isSale: resolved.isSale,
                priceListId: resolved.priceListId,
              }
            : null,
        },
      };
    },
  );
}

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function serializePriceListEngine(row: PriceList): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    applicationRule: row.applicationRule,
    isSystem: row.isSystem,
    modifiedAt: row.modifiedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

