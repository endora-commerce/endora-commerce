/**
 * `promotions`' four hookable actions (issue #1844, on the mechanism of
 * `specs/176-command-hooks-outbox/`).
 *
 * Each Command is held to its ref with `expectHookableCommand`, and each is run
 * on a real `CommandBus` with a sealed hook registry over a fake EM that keeps
 * what a transaction persisted apart from what it committed — so "the veto
 * rolled it back" and "the outbox row committed with the write" are
 * measurements rather than assumptions.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  PROMOTION_HOOKABLE_ACTIONS as PROMO,
  type CouponCreateSingleHookData,
  type HookableActionRef,
  type OutboxData,
  type CouponGenerateBatchHookData,
  type PromotionCreateHookData,
  type PromotionUpdateHookData,
} from '@endora-commerce/contracts';
import { CommandBus, type Command, type CommandHookEntry } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand, recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { CouponBatch } from '../entities/coupon-batch.entity.js';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';
import { CouponService } from '../services/coupon-service.js';
import type { UpsertPromotionInput } from '../services/promotion-data.js';
import { makeCreateCouponCommand } from './create-coupon.command.js';
import { makeCreatePromotionCommand } from './create-promotion.command.js';
import { makeGenerateCouponBatchCommand } from './generate-coupon-batch.command.js';
import { makeUpdatePromotionCommand } from './update-promotion.command.js';

const PROMOTION_ID = '00000000-0000-4000-8000-000000184401';
const ORG_ID = '00000000-0000-4000-8000-000000184402';
const RULE_ID = '00000000-0000-4000-8000-000000184403';
/** Free text a hook's stored outbox row must never carry. */
const SENTINELS = ['S1844-'];

function storedPromotion(): Promotion {
  return Object.assign(new Promotion(), {
    id: PROMOTION_ID,
    code: 'S1844-CODE',
    name: 'S1844-NAME',
    description: 'S1844-DESC',
    kind: null,
    value: null,
    actionType: 'percentage_off_cart',
    actionConfig: { percent: 10 },
    isActive: true,
    organizationId: ORG_ID,
    ruleId: RULE_ID,
    usageLimitGlobal: 100,
    usageLimitPerCustomer: 2,
    validFrom: new Date('2026-11-01T00:00:00.000Z'),
    validUntil: null,
  });
}

const createInput: UpsertPromotionInput = {
  name: 'S1844-NAME',
  code: 'S1844-CODE',
  action: { type: 'percentage_off_cart', percent: 10 },
  isActive: true,
  organizationId: ORG_ID,
  usageLimitPerOrganization: 5,
  validFrom: '2026-11-01T00:00:00.000Z',
};

type HookModules = ReadonlyArray<{ moduleId: string; entries: readonly CommandHookEntry[] }>;
/** Any of the four refs, for the cases every action shares. */
type AnyRef = HookableActionRef<unknown, OutboxData>;

/**
 * A fake EM for the four Commands: one stored promotion, no stored coupon,
 * creates kept in memory. `persist` buffers per transaction; the buffer moves
 * to `committed` only when the transaction's callback resolves.
 */
function harness(hooks: HookModules, options: { present?: (moduleId: string) => boolean } = {}) {
  const stored = storedPromotion();
  const audits: Array<Record<string, unknown>> = [];
  const committed: unknown[] = [];
  let pending: unknown[] = [];
  let pendingAudits: Array<Record<string, unknown>> = [];
  const em: Record<string, unknown> = {
    findOne: async (entity: unknown, where: { id?: string; code?: string }) =>
      entity === Promotion && (where.id === PROMOTION_ID || where.code === stored.code) ? stored : null,
    find: async () => [],
    create: (entity: new () => object, data: Record<string, unknown>) => Object.assign(new entity(), data),
    persist: (row: unknown) => {
      pending.push(row);
      return em;
    },
    flush: async () => undefined,
  };
  em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => {
    pending = [];
    pendingAudits = [];
    const result = await fn(em as unknown as EntityManager);
    committed.push(...pending);
    audits.push(...pendingAudits);
    return result;
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin: (_em: unknown, entry: Record<string, unknown>) => {
      pendingAudits.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'promotions', ...declaration })),
    moduleDependencies: { acme_erp: ['promotions'] },
    hooks,
    ...(options.present ? { isPresent: options.present } : {}),
  });
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), { hooks: registry });
  /** What the bus wrote to `command_outbox` and committed (rows carry `hookModule`). */
  const outboxRows = () =>
    committed.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && 'hookModule' in row);
  return { bus, audits, committed, outboxRows, stored, em: em as unknown as EntityManager };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('promotions unit test: hookable actions', fn);
const validate = async (): Promise<void> => undefined;

/** An `afterCommit` handler entry the outbox delivers later; registering it is what writes the row. */
function deliverTo(on: AnyRef): CommandHookEntry {
  return { id: `deliver-${on.action.replace(/[._]+/g, '-')}`, on, phase: 'afterCommit', handler: async () => undefined } as CommandHookEntry;
}

/** The four Commands, each built against the harness's stored promotion. */
const COMMANDS: ReadonlyArray<{ name: string; ref: AnyRef; make: () => Command<unknown> }> = [
  { name: 'promotion.create', ref: PROMO.create, make: () => makeCreatePromotionCommand({ input: createInput, validate }) as Command<unknown> },
  {
    name: 'promotion.update',
    ref: PROMO.update,
    make: () =>
      makeUpdatePromotionCommand({ promotionId: PROMOTION_ID, input: { ...createInput, isActive: false }, validate }) as Command<unknown>,
  },
  {
    name: 'coupon.create_single',
    ref: PROMO.createCoupon,
    make: () => makeCreateCouponCommand({ promotionId: PROMOTION_ID, code: 'S1844-COUPON' }) as Command<unknown>,
  },
  {
    name: 'coupon.generate_batch',
    ref: PROMO.generateCouponBatch,
    make: () =>
      makeGenerateCouponBatchCommand({
        promotionId: PROMOTION_ID,
        request: { count: 3, length: 8, format: 'alnum', prefix: 'S1844-', limitScope: 'shared_batch' },
      }) as Command<unknown>,
  },
];

describe('promotions declares four hookable actions (#1844)', () => {
  it('lists the four refs in its manifest, for both phases', () => {
    expect(manifest.hookableActions).toEqual(
      [PROMO.create, PROMO.update, PROMO.createCoupon, PROMO.generateCouponBatch].map((ref) => ({
        action: ref.action,
        objectType: ref.objectType,
        phases: ['beforeCommit', 'afterCommit'],
      })),
    );
  });
});

describe('promotion.create is hookable', () => {
  it('supplies hookData and list-1 outboxData', () => {
    expectHookableCommand(makeCreatePromotionCommand({ input: createInput, validate }), PROMO.create, {
      result: storedPromotion(),
      sentinels: SENTINELS,
    });
  });

  it('hands a hook ids, codes, the type and the limit scopes, and merges its noted names into the one entry', async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      { moduleId: 'acme_erp', entries: [recording.on(PROMO.create, { then: (ctx) => ctx.noteAuditChanges(['x_acme_erp_ref']) })] },
    ]);
    const command = makeCreatePromotionCommand({ input: createInput, validate, extensions: { acme_erp: { ref: 'E-1' } } });

    const row = await asSystem(() => h.bus.run(command));

    expect(recording.calls).toHaveLength(1);
    const data = recording.calls[0]!.data as PromotionCreateHookData;
    expect(data).toEqual({
      promotionId: row.id,
      code: 'S1844-CODE',
      kind: null,
      actionType: 'percentage_off_cart',
      isActive: true,
      ruleId: null,
      organizationId: ORG_ID,
      customerGroupId: null,
      categoryId: null,
      productId: null,
      currency: null,
      validFrom: '2026-11-01T00:00:00.000Z',
      validUntil: null,
      usageLimitScopes: ['per_organization'],
    });
    expect(JSON.stringify(data)).not.toContain('S1844-NAME');
    expect(recording.calls[0]!.extension).toEqual({ ref: 'E-1' });
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ action: 'promotion.create', objectType: 'promotion', objectId: row.id });
    expect(h.audits[0]!['stateAfter']).toMatchObject({
      name: 'S1844-NAME',
      code: 'S1844-CODE',
      extensions: { acme_erp: { changedFields: ['x_acme_erp_ref'] } },
    });
    expect(h.committed).toContain(row);
  });
});

describe('promotion.update is hookable — and is how a promotion is switched on and off', () => {
  it('supplies hookData and list-1 outboxData', () => {
    expectHookableCommand(
      makeUpdatePromotionCommand({ promotionId: PROMOTION_ID, input: createInput, validate }),
      PROMO.update,
      { result: { promotion: storedPromotion(), changedFields: ['isActive'], wasActive: true }, sentinels: SENTINELS },
    );
  });

  it('hands a hook the names of what changed and the deactivation', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(PROMO.update)] }]);

    await asSystem(() =>
      h.bus.run(
        makeUpdatePromotionCommand({
          promotionId: PROMOTION_ID,
          input: {
            name: 'S1844-RENAMED',
            action: { type: 'percentage_off_cart', percent: 10 },
            isActive: false,
            validFrom: '2026-11-01T00:00:00.000Z',
          },
          validate,
        }),
      ),
    );

    const data = recording.calls[0]!.data as PromotionUpdateHookData;
    // `actionConfig` and `validFrom` were set to what they already held.
    expect(data.changedFields).toEqual(['isActive', 'name']);
    expect(data.activationChange).toBe('deactivated');
    expect(data).toMatchObject({ promotionId: PROMOTION_ID, isActive: false, usageLimitScopes: ['global', 'per_customer'] });
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ action: 'promotion.update', objectId: PROMOTION_ID, stateBefore: null });
  });

  it('reports an activation, and no activation change when isActive held', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(PROMO.update)] }]);
    h.stored.isActive = false;

    await asSystem(() =>
      h.bus.run(makeUpdatePromotionCommand({ promotionId: PROMOTION_ID, input: { name: 'S1844-NAME', isActive: true }, validate })),
    );
    await asSystem(() =>
      h.bus.run(makeUpdatePromotionCommand({ promotionId: PROMOTION_ID, input: { name: 'S1844-NAME', isActive: true }, validate })),
    );

    expect(recording.calls.map((call) => (call.data as PromotionUpdateHookData).activationChange)).toEqual(['activated', null]);
    expect(recording.calls.map((call) => (call.data as PromotionUpdateHookData).changedFields)).toEqual([['isActive'], []]);
  });

  it('refuses an unknown promotion with 404 before any hook runs', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(PROMO.update)] }]);
    const missing = '00000000-0000-4000-8000-000000184499';

    const err = await asSystem(() =>
      h.bus.run(makeUpdatePromotionCommand({ promotionId: missing, input: createInput, validate })),
    ).catch((e: unknown) => e);

    expect(err).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(recording.calls).toEqual([]);
    expect(h.audits).toEqual([]);
  });
});

describe('coupon.create_single is hookable', () => {
  it('supplies hookData and list-1 outboxData — never the code in the stored row', () => {
    const coupon = Object.assign(new PromotionCoupon(), {
      id: '00000000-0000-4000-8000-000000184410',
      promotionId: PROMOTION_ID,
      batchId: null,
      code: 'S1844-COUPON',
      limitScope: 'per_coupon' as const,
      isActive: true,
    });
    expectHookableCommand(makeCreateCouponCommand({ promotionId: PROMOTION_ID, code: 'S1844-COUPON' }), PROMO.createCoupon, {
      result: coupon,
      sentinels: SENTINELS,
    });
  });

  it('hands a hook the coupon id and code, through the CouponService', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(PROMO.createCoupon)] }]);
    const service = new CouponService(() => h.em, h.bus);

    const coupon = await asSystem(() => service.createSingle(PROMOTION_ID, 'S1844-COUPON'));

    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.data as CouponCreateSingleHookData).toEqual({
      promotionId: PROMOTION_ID,
      couponId: coupon.id,
      code: 'S1844-COUPON',
      limitScope: 'per_coupon',
    });
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'coupon.create_single',
        objectType: 'promotion',
        objectId: PROMOTION_ID,
        stateBefore: null,
        stateAfter: { code: 'S1844-COUPON' },
      }),
    ]);
  });
});

describe('coupon.generate_batch is hookable', () => {
  it('supplies hookData and list-1 outboxData — never the codes in the stored row', () => {
    const batch = Object.assign(new CouponBatch(), {
      id: '00000000-0000-4000-8000-000000184420',
      promotionId: PROMOTION_ID,
      prefix: 'S1844-',
      limitScope: 'shared_batch' as const,
    });
    expectHookableCommand(COMMANDS[3]!.make(), PROMO.generateCouponBatch, {
      result: { batch, generated: 2, codes: ['S1844-AAAA', 'S1844-BBBB'] },
      sentinels: SENTINELS,
    });
  });

  it('hands a hook the batch id, the count, the scope and the generated codes', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(PROMO.generateCouponBatch)] }]);
    const service = new CouponService(() => h.em, h.bus);

    const result = await asSystem(() =>
      service.generateBatch(PROMOTION_ID, { count: 3, length: 8, format: 'digits', limitScope: 'shared_batch' }),
    );

    const data = recording.calls[0]!.data as CouponGenerateBatchHookData;
    expect(data).toMatchObject({ promotionId: PROMOTION_ID, batchId: result.batch.id, generated: 3, limitScope: 'shared_batch' });
    expect(data.codes).toHaveLength(3);
    for (const code of data.codes) expect(code).toMatch(/^[0-9]{8}$/);
    const coupons = h.committed.filter((row): row is PromotionCoupon => row instanceof PromotionCoupon);
    expect(coupons.map((c) => c.code)).toEqual(data.codes);
    expect(coupons.every((c) => c.batchId === result.batch.id)).toBe(true);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'coupon.generate_batch',
        objectId: PROMOTION_ID,
        stateAfter: { batchId: result.batch.id, generated: 3 },
      }),
    ]);
  });
});

describe.each(COMMANDS)('$name — the hook phases', ({ ref, make }) => {
  it('a beforeCommit veto refuses the write with its own error and rolls it back', async () => {
    const vetoed = Object.assign(new Error('refused'), { statusCode: 409, code: 'ACME_PROMOTION_REFUSED' });
    const h = harness([
      {
        moduleId: 'acme_erp',
        entries: [
          recordingCommandHooks().on(ref, {
            then: () => {
              throw vetoed;
            },
          }),
          deliverTo(ref),
        ],
      },
    ]);

    const err = await asSystem(() => h.bus.run(make())).catch((e: unknown) => e);

    expect(err).toBe(vetoed);
    expect(h.committed).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(h.outboxRows()).toEqual([]);
  });

  it('skips the hooks of a switched-off module, as if it were not installed (XVII)', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(ref), deliverTo(ref)] }], {
      present: (moduleId) => moduleId !== 'acme_erp',
    });

    await asSystem(() => h.bus.run(make()));

    expect(recording.calls).toEqual([]);
    expect(h.outboxRows()).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]!['stateAfter']).not.toHaveProperty('extensions');
  });

  it('writes one outbox row per afterCommit handler, committed with the write, carrying list-1 data only', async () => {
    const h = harness([{ moduleId: 'acme_erp', entries: [deliverTo(ref)] }]);

    await asSystem(() => h.bus.run(make()));

    const rows = h.outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: ref.action,
      objectType: 'promotion',
      hookModule: 'acme_erp',
      hookId: `deliver-${ref.action.replace(/[._]+/g, '-')}`,
      organizationId: null,
    });
    expect(rows[0]!['data']).toHaveProperty('promotionId');
    for (const sentinel of SENTINELS) expect(JSON.stringify(rows[0]!['data'])).not.toContain(sentinel);
    expect(h.audits).toHaveLength(1);
  });
});
