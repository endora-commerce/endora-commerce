import {
  ERROR_CODES,
  isUuidShape,
  type PromotionUpdateHookData,
  type PromotionUpdateOutbox,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Promotion } from '../entities/promotion.entity.js';
import { buildPromotionData, changedPromotionFields, type UpsertPromotionInput } from '../services/promotion-data.js';
import type { PromotionInputValidator } from './create-promotion.command.js';
import { promotionHookSummary, promotionOutbox } from './promotion-hook-data.js';

export interface UpdatePromotionResult {
  readonly promotion: Promotion;
  /** Sorted names of the columns whose value changed. */
  readonly changedFields: readonly string[];
  /** `isActive` before the write. */
  readonly wasActive: boolean;
}

function activationChange({ promotion, wasActive }: UpdatePromotionResult): 'activated' | 'deactivated' | null {
  if (promotion.isActive === wasActive) return null;
  return promotion.isActive ? 'activated' : 'deactivated';
}

/**
 * `promotion.update` — an operator edits a promotion (issue #1844; the write
 * `PromotionService.updateById`, and `upsert` for a code that already exists,
 * made by hand with a co-transactional audit row until then).
 *
 * There is no separate activation write: the edit form's *Active* checkbox is
 * this Command, so switching a promotion on or off is an update whose hook
 * data says so in `activationChange`.
 *
 * The audit state is what the edit always recorded — `stateBefore: null`, the
 * name and the code after — so the audit log reads as it did. Hookable
 * (`PROMOTION_HOOKABLE_ACTIONS.update`); not reversible.
 */
export function makeUpdatePromotionCommand(params: {
  promotionId: string;
  input: UpsertPromotionInput;
  validate: PromotionInputValidator;
  /** Extension input for the hook modules on this action, keyed by module id (176 FR-018). */
  extensions?: Readonly<Record<string, unknown>>;
}): Command<UpdatePromotionResult> {
  const { promotionId, input, validate } = params;
  return {
    action: 'promotion.update',
    objectType: 'promotion',
    objectId: promotionId,
    ...(params.extensions ? { extensions: params.extensions } : {}),
    hookData: (result): PromotionUpdateHookData => ({
      ...promotionHookSummary(result.promotion),
      changedFields: [...result.changedFields],
      activationChange: activationChange(result),
    }),
    outboxData: (result): PromotionUpdateOutbox => ({
      ...promotionOutbox(result.promotion),
      changedFields: [...result.changedFields],
      activationChange: activationChange(result),
    }),
    run: async ({ em }) => {
      const notFound = (): HttpError => new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${promotionId} not found.`);
      if (!isUuidShape(promotionId)) throw notFound();
      const existing = await em.findOne(Promotion, { id: promotionId });
      if (!existing) throw notFound();
      await validate(em, input, existing);
      const data = buildPromotionData(input);
      const before = Object.fromEntries(
        Object.keys(data).map((field) => [field, (existing as unknown as Record<string, unknown>)[field]]),
      );
      const wasActive = existing.isActive;
      const changedFields = changedPromotionFields(before, data);
      Object.assign(existing, data);
      await em.flush();
      return {
        result: { promotion: existing, changedFields, wasActive },
        before: null,
        after: { name: existing.name, code: existing.code },
      };
    },
  };
}
