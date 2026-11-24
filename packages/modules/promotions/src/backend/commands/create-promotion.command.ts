import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PromotionCreateHookData, PromotionCreateOutbox } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { Promotion } from '../entities/promotion.entity.js';
import { buildPromotionData, type UpsertPromotionInput } from '../services/promotion-data.js';
import { promotionHookSummary, promotionOutbox } from './promotion-hook-data.js';

/**
 * The checks an input passes before it is written: the criteria against the
 * catalogue's attributes, the action against the registry, the named rule and
 * the currency. `PromotionService` owns them because they need its ports; a
 * Command runs them on its own transaction. `existing` is the row an edit
 * changes, `null` for a create.
 */
export type PromotionInputValidator = (
  em: EntityManager,
  input: UpsertPromotionInput,
  existing: Promotion | null,
) => Promise<void>;

/**
 * `promotion.create` — an operator creates a promotion (issue #1844; the write
 * `PromotionService.upsert` made by hand, with a co-transactional audit row,
 * until then).
 *
 * The id is chosen here so the audit entry and a hook can name the row before
 * it is flushed. The audit state is what that row always recorded: the
 * promotion's name and code — a promotion is a platform-global record
 * (`specs/conventions/audit-state.md` §5).
 *
 * Binding the new promotion to the default sales channel is **not** part of
 * this Command: `PromotionService.upsert` does it after the commit, as it did
 * before the write was a Command, so a hook sees the promotion without its
 * channel.
 *
 * Hookable (`PROMOTION_HOOKABLE_ACTIONS.create`): a hook is handed ids, codes,
 * the type, the window and the usage-limit scopes. Not reversible
 * (`contracts/command-hooks-api.md` §6).
 */
export function makeCreatePromotionCommand(params: {
  input: UpsertPromotionInput;
  validate: PromotionInputValidator;
  /** Extension input for the hook modules on this action, keyed by module id (176 FR-018). */
  extensions?: Readonly<Record<string, unknown>>;
}): Command<Promotion> {
  const { input, validate } = params;
  const id = randomUUID();
  return {
    action: 'promotion.create',
    objectType: 'promotion',
    objectId: id,
    ...(params.extensions ? { extensions: params.extensions } : {}),
    hookData: (row): PromotionCreateHookData => promotionHookSummary(row),
    outboxData: (row): PromotionCreateOutbox => promotionOutbox(row),
    run: async ({ em }) => {
      await validate(em, input, null);
      // `data` is built from a partial input; `name` is always present per the
      // schema, but the conditional spreads widen the inferred type.
      const row = em.create(Promotion, { ...buildPromotionData(input), id } as unknown as Promotion);
      await em.persist(row).flush();
      return { result: row, before: null, after: { name: row.name, code: row.code } };
    },
  };
}
