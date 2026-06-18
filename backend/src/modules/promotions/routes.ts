import type { FastifyInstance } from 'fastify';
import {
  cartSnapshotSchema,
  generateCouponsRequestSchema,
  upsertPromotionRequestSchema,
  upsertPromotionRuleRequestSchema,
  type PromotionAction,
} from '@b2b/contracts';
import type { PromotionService, UpsertPromotionInput } from './services/promotion-service.js';
import type { CouponService } from './services/coupon-service.js';
import type { PromotionRuleStore } from './services/promotion-rule-store.js';
import type { Promotion } from './entities/promotion.entity.js';
import type { PromotionCoupon } from './entities/promotion-coupon.entity.js';
import type { PromotionRuleEntity } from './entities/promotion-rule.entity.js';
import { PROMOTION_PERMISSIONS } from './manifest.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { CatalogQueryService } from '../catalog/services/catalog-query.service.js';

export interface PromotionRoutesDeps {
  promotionService: PromotionService;
  couponService: CouponService;
  ruleStore: PromotionRuleStore;
  requireAdmin: RequireAdminFactory;
  /** Feature 012 / US8 — feeds the rule-target picker endpoint. */
  catalogQueryService?: CatalogQueryService;
}

export async function registerPromotionRoutes(
  app: FastifyInstance,
  deps: PromotionRoutesDeps,
): Promise<void> {
  const { promotionService, couponService, ruleStore, requireAdmin, catalogQueryService } = deps;
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
    async (_request, reply) => {
      if (!catalogQueryService) {
        reply.status(503);
        return { error: { code: 'service_unavailable', message: 'Catalog port not configured.' } };
      }
      const keys = await catalogQueryService.promoRuleAttributeKeys();
      const items = [];
      for (const k of keys) {
        const meta = await catalogQueryService.getAttributeWithOptions(k);
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
    { preHandler: readGate },
    async (request, reply) => {
      const codes = await couponService.listBatchCodes(request.params.batchId);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="coupons-${request.params.batchId}.csv"`);
      return reply.send(`code\n${codes.join('\n')}\n`);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id',
    { preHandler: deleteGate },
    async (request, reply) => {
      await promotionService.remove(request.params.id);
      return reply.status(204).send();
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
