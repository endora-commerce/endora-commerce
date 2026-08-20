import type { FastifyInstance } from 'fastify';
import {
  bulkCouponActiveRequestSchema,
  cartSnapshotSchema,
  generateCouponsRequestSchema,
  upsertPromotionRequestSchema,
  upsertPromotionRuleRequestSchema,
  type PromotionAction,
} from '@b2b/contracts';
import type { PromotionService, UpsertPromotionInput } from './services/promotion-service.js';
import type { CouponService } from './services/coupon-service.js';
import type { PromotionRuleStore } from './services/promotion-rule-store.js';
import type { PromotionStatsService, StatsQuery } from './services/promotion-stats-service.js';

/**
 * List ports feeding the Rule Builder pickers (feature 045, US1/T033).
 *
 * Declared here rather than in a module factory since feature 072 (T115): the
 * factory is gone, and these are the routes' own option shape. Every member is
 * optional because a composition may know how to list some target kinds and not
 * others — an absent one yields an empty picker rather than a broken screen.
 */
export interface PromotionRuleTargetPorts {
  salesChannels?: () => Promise<Array<{ id: string; code: string; name: string }>>;
  customerGroups?: () => Promise<Array<{ id: string; code: string; name: string }>>;
  organizations?: () => Promise<Array<{ id: string; name: string; taxId: string | null }>>;
  categories?: () => Promise<
    Array<{ id: string; slug: string; name: string; parentCategoryId: string | null }>
  >;
  paymentMethods?: () => Promise<Array<{ id: string; code: string; name: string }>>;
  deliveryMethods?: () => Promise<Array<{ id: string; code: string; name: string }>>;
}
import { promotionStatsGroupBySchema } from '@b2b/contracts';
import type { Promotion } from './entities/promotion.entity.js';
import type { PromotionCoupon } from './entities/promotion-coupon.entity.js';
import type { PromotionRuleEntity } from './entities/promotion-rule.entity.js';
import { PROMOTION_PERMISSIONS } from './manifest.js';
import type { CatalogPromoAttributePort } from '@b2b/contracts';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface PromotionRoutesDeps {
  promotionService: PromotionService;
  couponService: CouponService;
  ruleStore: PromotionRuleStore;
  statsService: PromotionStatsService;
  requireAdmin: RequireAdminFactory;
  /**
   * Feature 012 / US8 — feeds the rule-target picker endpoint. Since feature
   * 075's Phase C this is `catalogPromoAttributePort`, the two questions this
   * picker asks, rather than `catalog`'s 1400-line storefront query service.
   *
   * **Required** (issue #164), for the reason the two ports on
   * `PromotionService` are. It was optional and the one call site there is —
   * `backend.ts`, through `lazyPort('catalogPromoAttributePort')` — always
   * supplied it, so the absent branch had never run; what it would have run
   * was `503 { code: 'service_unavailable' }`, a code written nowhere else in
   * the repository, in no `ERROR_CODES`, with no translation and no admin
   * handler. That made it a second spelling of one absence, and the platform
   * already spells that absence once: `lazyPort` resolves inside the forwarded
   * call, so an owner that is not there throws `ModuleDisabledError` and the
   * envelope answers 503 `MODULE_DISABLED` naming the module. Here even that
   * cannot happen — `catalog` declares `activation.nonDeactivatable`, so the
   * gate on this port has no closed state — which leaves exactly one absence
   * this route can see, and it is the one `getAttributeWithOptions` already
   * says in its return type: `null`, no such attribute.
   */
  catalogPromoAttributes: CatalogPromoAttributePort;
  /**
   * Feature 045 (T033) — list ports for the remaining rule-target pickers.
   *
   * The bundle is required and its **members** are not: the container
   * registers `promotionRuleTargets` with a `{}` default that a composition
   * root contributes over, so the routes always receive one, while which
   * picker kinds it knows how to list stays the composition's business
   * (issue #164 again — the outer `?.` guarded nothing).
   */
  ruleTargets: PromotionRuleTargetPorts;
}

export async function registerPromotionRoutes(
  app: FastifyInstance,
  deps: PromotionRoutesDeps,
): Promise<void> {
  const {
    promotionService,
    couponService,
    ruleStore,
    statsService,
    requireAdmin,
    catalogPromoAttributes,
    ruleTargets,
  } = deps;

  const parseStatsQuery = (q: Record<string, unknown>): StatsQuery => {
    const out: StatsQuery = {};
    if (typeof q['from'] === 'string') out.from = q['from'];
    if (typeof q['to'] === 'string') out.to = q['to'];
    const gb = promotionStatsGroupBySchema.safeParse(q['groupBy']);
    if (gb.success) out.groupBy = gb.data;
    return out;
  };
  const readGate = requireAdmin(PROMOTION_PERMISSIONS.READ);
  const writeGate = requireAdmin(PROMOTION_PERMISSIONS.WRITE);
  const deleteGate = requireAdmin(PROMOTION_PERMISSIONS.DELETE);

  app.get('/api/v1/admin/promotions', { preHandler: readGate }, async () => {
    const rows = await promotionService.list();
    return { data: rows.map(serialize) };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id',
    { preHandler: readGate },
    async (request) => {
      const row = await promotionService.getById(request.params.id);
      return { data: serialize(row) };
    },
  );

  // Feature 045 — action catalogue introspection for the admin action picker.
  app.get('/api/v1/admin/promotions/action-types', { preHandler: readGate }, async () => {
    return { data: { items: promotionService.listActionTypes() } };
  });

  // Feature 045 (US6) — standalone named rules.
  app.get('/api/v1/admin/promotion-rules', { preHandler: readGate }, async () => {
    const rows = await ruleStore.list();
    return { data: rows.map(serializeRule) };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/promotion-rules/:id',
    { preHandler: readGate },
    async (request) => {
      const row = await ruleStore.getById(request.params.id);
      const usedBy = await ruleStore.usedBy(request.params.id);
      return { data: serializeRule(row), usedBy };
    },
  );

  app.post(
    '/api/v1/admin/promotion-rules',
    { preHandler: writeGate, schema: { body: upsertPromotionRuleRequestSchema } },
    async (request, reply) => {
      const body = upsertPromotionRuleRequestSchema.parse(request.body);
      const row = await ruleStore.create({
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        definition: body.definition,
      });
      reply.status(201);
      return { data: serializeRule(row) };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/promotion-rules/:id',
    { preHandler: writeGate, schema: { body: upsertPromotionRuleRequestSchema } },
    async (request) => {
      const body = upsertPromotionRuleRequestSchema.parse(request.body);
      const row = await ruleStore.update(request.params.id, {
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        definition: body.definition,
      });
      return { data: serializeRule(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/promotion-rules/:id',
    { preHandler: deleteGate },
    async (request, reply) => {
      await ruleStore.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/admin/promotions',
    { preHandler: writeGate, schema: { body: upsertPromotionRequestSchema } },
    async (request, reply) => {
      const body = upsertPromotionRequestSchema.parse(request.body);
      const row = await promotionService.upsert(toUpsertInput(body));
      reply.status(201);
      return { data: serialize(row) };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id',
    { preHandler: writeGate, schema: { body: upsertPromotionRequestSchema } },
    async (request) => {
      const body = upsertPromotionRequestSchema.parse(request.body);
      const row = await promotionService.updateById(request.params.id, toUpsertInput(body));
      return { data: serialize(row) };
    },
  );

  // Feature 012 / US8 — picker payload for the Promotion Rule editor.
  app.get(
    '/api/v1/admin/promotions/rule-targets/attributes',
    { preHandler: readGate },
    async () => {
      const keys = await catalogPromoAttributes.promoRuleAttributeKeys();
      const items = [];
      for (const k of keys) {
        const meta = await catalogPromoAttributes.getAttributeWithOptions(k);
        if (!meta) continue;
        const isSelectStyle =
          meta.valueType === 'select' ||
          meta.valueType === 'enum' ||
          meta.valueType === 'multiselect';
        items.push({
          id: meta.id,
          key: meta.key,
          label: meta.label,
          labelDefault: meta.labelDefault,
          valueType: meta.valueType,
          ...(isSelectStyle ? { options: meta.options } : {}),
        });
      }
      return { data: { items } };
    },
  );

  // Feature 045 (US3) — single coupon management for a promotion.
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id/coupons',
    { preHandler: readGate },
    async (request) => {
      const coupons = await couponService.listForPromotion(request.params.id);
      return { data: coupons.map(serializeCoupon) };
    },
  );

  app.post<{ Params: { id: string }; Body: { code?: unknown } }>(
    '/api/v1/admin/promotions/:id/coupons',
    { preHandler: writeGate },
    async (request, reply) => {
      const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
      if (!code) {
        reply.status(400);
        return { error: { code: 'validation_failed', message: 'code is required' } };
      }
      const coupon = await couponService.createSingle(request.params.id, code);
      reply.status(201);
      return { data: serializeCoupon(coupon) };
    },
  );

  // Bulk activate/deactivate selected coupons of a promotion.
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id/coupons/bulk-active',
    { preHandler: writeGate, schema: { body: bulkCouponActiveRequestSchema } },
    async (request) => {
      const body = bulkCouponActiveRequestSchema.parse(request.body);
      const updated = await couponService.setActiveBulk(
        request.params.id,
        body.couponIds,
        body.isActive,
      );
      return { data: { updated } };
    },
  );

  // Feature 045 (US4) — bulk coupon generator.
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id/coupon-batches',
    { preHandler: writeGate, schema: { body: generateCouponsRequestSchema } },
    async (request, reply) => {
      const body = generateCouponsRequestSchema.parse(request.body);
      const result = await couponService.generateBatch(request.params.id, body);
      reply.status(201);
      return { data: { batch: { id: result.batch.id }, generated: result.generated } };
    },
  );

  app.get<{ Params: { id: string; batchId: string } }>(
    '/api/v1/admin/promotions/:id/coupon-batches/:batchId/export',
    { preHandler: readGate, config: { streamingResponse: true } },
    async (request, reply) => {
      const codes = await couponService.listBatchCodes(request.params.batchId);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="coupons-${request.params.batchId}.csv"`);
      return reply.send(`code\n${codes.join('\n')}\n`);
    },
  );

  // Feature 045 (T033) — rule-target pickers feeding the Rule Builder.
  app.get('/api/v1/admin/promotions/rule-targets/sales-channels', { preHandler: readGate }, async () => ({
    data: { items: (await ruleTargets.salesChannels?.()) ?? [] },
  }));
  app.get('/api/v1/admin/promotions/rule-targets/customer-groups', { preHandler: readGate }, async () => ({
    data: { items: (await ruleTargets.customerGroups?.()) ?? [] },
  }));
  app.get('/api/v1/admin/promotions/rule-targets/organizations', { preHandler: readGate }, async () => ({
    data: { items: (await ruleTargets.organizations?.()) ?? [] },
  }));
  app.get('/api/v1/admin/promotions/rule-targets/categories', { preHandler: readGate }, async () => ({
    data: { items: (await ruleTargets.categories?.()) ?? [] },
  }));
  app.get('/api/v1/admin/promotions/rule-targets/payment-methods', { preHandler: readGate }, async () => ({
    data: { items: (await ruleTargets.paymentMethods?.()) ?? [] },
  }));
  app.get('/api/v1/admin/promotions/rule-targets/delivery-methods', { preHandler: readGate }, async () => ({
    data: { items: (await ruleTargets.deliveryMethods?.()) ?? [] },
  }));

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id',
    { preHandler: deleteGate },
    async (request, reply) => {
      await promotionService.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  // Feature 045 (US7) — usage statistics.
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    '/api/v1/admin/promotions/:id/stats',
    { preHandler: readGate },
    async (request) => {
      const data = await statsService.forPromotion(request.params.id, parseStatsQuery(request.query ?? {}));
      return { data };
    },
  );

  app.get<{ Params: { couponId: string }; Querystring: Record<string, unknown> }>(
    '/api/v1/admin/promotions/coupons/:couponId/stats',
    { preHandler: readGate },
    async (request) => {
      const data = await statsService.forCoupon(request.params.couponId, parseStatsQuery(request.query ?? {}));
      return { data };
    },
  );

  app.post(
    '/api/v1/admin/promotions/preview',
    { preHandler: readGate, schema: { body: cartSnapshotSchema } },
    async (request) => {
      const snapshot = cartSnapshotSchema.parse(request.body);
      const result = await promotionService.applyToCart(snapshot);
      return { data: result };
    },
  );
}

type UpsertBody = ReturnType<typeof upsertPromotionRequestSchema.parse>;

/** Pass through validated request fields into the service input. */
function toUpsertInput(body: UpsertBody): UpsertPromotionInput {
  return {
    name: body.name,
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.value !== undefined ? { value: body.value } : {}),
    ...(body.currency !== undefined ? { currency: body.currency } : {}),
    ...(body.minCartSubtotal !== undefined ? { minCartSubtotal: body.minCartSubtotal } : {}),
    ...(body.validFrom !== undefined ? { validFrom: body.validFrom } : {}),
    ...(body.validUntil !== undefined ? { validUntil: body.validUntil } : {}),
    ...(body.organizationId !== undefined ? { organizationId: body.organizationId } : {}),
    ...(body.customerGroupId !== undefined ? { customerGroupId: body.customerGroupId } : {}),
    ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
    ...(body.productId !== undefined ? { productId: body.productId } : {}),
    ...(body.criteria !== undefined ? { criteria: body.criteria } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.stopFurther !== undefined ? { stopFurther: body.stopFurther } : {}),
    ...(body.action !== undefined ? { action: body.action } : {}),
    ...(body.ruleId !== undefined ? { ruleId: body.ruleId } : {}),
    ...(body.rule !== undefined ? { rule: body.rule } : {}),
    ...(body.usageLimitGlobal !== undefined ? { usageLimitGlobal: body.usageLimitGlobal } : {}),
    ...(body.usageLimitPerOrganization !== undefined
      ? { usageLimitPerOrganization: body.usageLimitPerOrganization }
      : {}),
    ...(body.usageLimitPerCustomer !== undefined
      ? { usageLimitPerCustomer: body.usageLimitPerCustomer }
      : {}),
  };
}

function serializeRule(r: PromotionRuleEntity): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    definition: r.definition,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeCoupon(c: PromotionCoupon): Record<string, unknown> {
  return {
    id: c.id,
    promotionId: c.promotionId,
    batchId: c.batchId ?? null,
    code: c.code,
    limitScope: c.limitScope,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  };
}

function serialize(row: Promotion): Record<string, unknown> {
  const action: PromotionAction | null = row.actionType
    ? ({ type: row.actionType, ...row.actionConfig } as PromotionAction)
    : null;
  return {
    id: row.id,
    code: row.code ?? null,
    name: row.name,
    kind: row.kind ?? null,
    value: row.value != null ? Number(row.value) : null,
    currency: row.currency ?? null,
    minCartSubtotal: row.minCartSubtotal != null ? Number(row.minCartSubtotal) : null,
    validFrom: row.validFrom?.toISOString() ?? null,
    validUntil: row.validUntil?.toISOString() ?? null,
    organizationId: row.organizationId ?? null,
    customerGroupId: row.customerGroupId ?? null,
    categoryId: row.categoryId ?? null,
    productId: row.productId ?? null,
    criteria: row.criteria ?? [],
    isActive: row.isActive,
    description: row.description ?? null,
    priority: row.priority,
    stopFurther: row.stopFurther,
    action,
    ruleId: row.ruleId ?? null,
    rule: row.ruleDefinition ?? null,
    usageLimitGlobal: row.usageLimitGlobal ?? null,
    usageLimitPerOrganization: row.usageLimitPerOrganization ?? null,
    usageLimitPerCustomer: row.usageLimitPerCustomer ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
