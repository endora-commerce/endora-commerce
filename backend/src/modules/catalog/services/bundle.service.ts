import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CommandBus } from '../../../commands/index.js';
import { Product } from '../entities/product.entity.js';
import { BundleSlot } from '../entities/bundle-slot.entity.js';
import { BundleSlotOption } from '../entities/bundle-slot-option.entity.js';

/**
 * BundleService — admin CRUD for bundle slots + their options, plus the
 * pure-compute `validateConfiguration` used by the public storefront
 * endpoint (feature 002 US5, T129).
 *
 * Same composite-nesting guard as GroupedService: option products MUST
 * NOT be `type='grouped'` or `type='bundle'` (research R-8).
 */

export interface BundleSlotRow {
  id: string;
  parentProductId: string;
  name: Record<string, string>;
  minQuantity: number;
  maxQuantity: number;
  position: number;
  options: BundleSlotOptionRow[];
}

export interface BundleSlotOptionRow {
  id: string;
  slotId: string;
  optionProductId: string;
  defaultQuantity: number;
  position: number;
}

export interface ConfigurationSelection {
  slotId: string;
  optionId: string;
  quantity: number;
}

export interface BundleValidationError {
  code: 'MIN_NOT_MET' | 'MAX_EXCEEDED' | 'UNKNOWN_OPTION';
  slotId?: string;
  message: string;
}

export interface BundleValidationResult {
  valid: boolean;
  errors: BundleValidationError[];
  resolvedSelections: Array<{
    slotId: string;
    optionId: string;
    optionProductId: string;
    quantity: number;
  }>;
}

export class BundleService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits bundle slot/option writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
  ) {}

  /** Feature 054 — run a bundle write through the Command Bus. */
  async #audited<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{
      result: T;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({ action, objectType: 'bundle_slot', objectId, run: ({ em }) => write(em) });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    return w.result;
  }

  async listSlots(parentProductId: string): Promise<BundleSlotRow[]> {
    const em = this.emFactory();
    await this.assertBundleParent(em, parentProductId);
    const slots = await em.find(
      BundleSlot,
      { parentProductId },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    if (slots.length === 0) return [];
    const slotIds = slots.map((s) => s.id);
    const options = await em.find(
      BundleSlotOption,
      { slotId: { $in: slotIds } },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    const optsBySlot = new Map<string, BundleSlotOption[]>();
    for (const opt of options) {
      const list = optsBySlot.get(opt.slotId) ?? [];
      list.push(opt);
      optsBySlot.set(opt.slotId, list);
    }
    return slots.map((s) => ({
      id: s.id,
      parentProductId: s.parentProductId,
      name: s.name,
      minQuantity: s.minQuantity,
      maxQuantity: s.maxQuantity,
      position: s.position,
      options: (optsBySlot.get(s.id) ?? []).map((o) => this.toOptionRow(o)),
    }));
  }

  async createSlot(
    parentProductId: string,
    input: {
      name: Record<string, string>;
      minQuantity?: number | undefined;
      maxQuantity: number;
      position?: number | undefined;
    },
  ): Promise<BundleSlotRow> {
    const em = this.emFactory();
    await this.assertBundleParent(em, parentProductId);
    const minQuantity = input.minQuantity ?? 0;
    if (minQuantity > input.maxQuantity) {
      throw new HttpError(
        400,
        ERROR_CODES.INVALID_QUANTITY_RANGE,
        `minQuantity (${minQuantity}) must be <= maxQuantity (${input.maxQuantity}).`,
      );
    }
    let position = input.position;
    if (position === undefined) {
      const tally = await em.find(BundleSlot, { parentProductId });
      position = tally.reduce((max, r) => Math.max(max, r.position + 1), 0);
    }
    const id = randomUUID();
    const slot = await this.#audited('bundle_slot.create', id, async (cem) => {
      const s = cem.create(BundleSlot, {
        id,
        parentProductId,
        name: input.name,
        minQuantity,
        maxQuantity: input.maxQuantity,
        position,
      });
      await cem.flush();
      return {
        result: s,
        before: null,
        after: { parentProductId, name: input.name, minQuantity, maxQuantity: input.maxQuantity, position },
      };
    });
    return {
      id: slot.id,
      parentProductId: slot.parentProductId,
      name: slot.name,
      minQuantity: slot.minQuantity,
      maxQuantity: slot.maxQuantity,
      position: slot.position,
      options: [],
    };
  }

  async updateSlot(
    parentProductId: string,
    slotId: string,
    input: {
      name?: Record<string, string> | undefined;
      minQuantity?: number | undefined;
      maxQuantity?: number | undefined;
      position?: number | undefined;
    },
  ): Promise<BundleSlotRow> {
    const slot = await this.#audited('bundle_slot.update', slotId, async (em) => {
      await this.assertBundleParent(em, parentProductId);
      const s = await em.findOne(BundleSlot, { id: slotId, parentProductId });
      if (!s) {
        throw new HttpError(
          404,
          ERROR_CODES.BUNDLE_SLOT_NOT_FOUND,
          `Bundle slot "${slotId}" not found on parent ${parentProductId}.`,
        );
      }
      const before = {
        name: s.name,
        minQuantity: s.minQuantity,
        maxQuantity: s.maxQuantity,
        position: s.position,
      };
      if (input.name !== undefined) s.name = input.name;
      if (input.minQuantity !== undefined) s.minQuantity = input.minQuantity;
      if (input.maxQuantity !== undefined) s.maxQuantity = input.maxQuantity;
      if (input.position !== undefined) s.position = input.position;
      if (s.minQuantity > s.maxQuantity) {
        throw new HttpError(
          400,
          ERROR_CODES.INVALID_QUANTITY_RANGE,
          `minQuantity (${s.minQuantity}) must be <= maxQuantity (${s.maxQuantity}).`,
        );
      }
      return {
        result: s,
        before,
        after: { name: s.name, minQuantity: s.minQuantity, maxQuantity: s.maxQuantity, position: s.position },
      };
    });
    const options = await this.emFactory().find(BundleSlotOption, { slotId });
    return {
      id: slot.id,
      parentProductId: slot.parentProductId,
      name: slot.name,
      minQuantity: slot.minQuantity,
      maxQuantity: slot.maxQuantity,
      position: slot.position,
      options: options.map((o) => this.toOptionRow(o)),
    };
  }

  async deleteSlot(parentProductId: string, slotId: string): Promise<void> {
    await this.#audited('bundle_slot.delete', slotId, async (em) => {
      await this.assertBundleParent(em, parentProductId);
      const slot = await em.findOne(BundleSlot, { id: slotId, parentProductId });
      if (!slot) {
        throw new HttpError(
          404,
          ERROR_CODES.BUNDLE_SLOT_NOT_FOUND,
          `Bundle slot "${slotId}" not found.`,
        );
      }
      const before = { parentProductId, name: slot.name };
      em.remove(slot);
      return { result: undefined, before, after: null };
    });
  }

  async addOption(
    parentProductId: string,
    slotId: string,
    input: {
      optionProductId: string;
      defaultQuantity?: number | undefined;
      position?: number | undefined;
    },
  ): Promise<BundleSlotOptionRow> {
    const em = this.emFactory();
    await this.assertBundleParent(em, parentProductId);
    const slot = await em.findOne(BundleSlot, { id: slotId, parentProductId });
    if (!slot) {
      throw new HttpError(
        404,
        ERROR_CODES.BUNDLE_SLOT_NOT_FOUND,
        `Bundle slot "${slotId}" not found.`,
      );
    }
    const option = await em.findOne(Product, { id: input.optionProductId });
    if (!option || option.deletedAt) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Option product "${input.optionProductId}" not found.`,
      );
    }
    if (option.type === 'grouped' || option.type === 'bundle') {
      throw new HttpError(
        400,
        ERROR_CODES.NESTED_COMPOSITE_NOT_ALLOWED,
        `Bundle options cannot themselves be ${option.type} products.`,
      );
    }
    // Pre-check duplicate so we surface OPTION_ALREADY_EXISTS rather than
    // a raw PG unique-violation message.
    const existing = await em.findOne(BundleSlotOption, {
      slotId,
      optionProductId: input.optionProductId,
    });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.OPTION_ALREADY_EXISTS,
        `Product "${input.optionProductId}" is already an option in this slot.`,
      );
    }
    let position = input.position;
    if (position === undefined) {
      const tally = await em.find(BundleSlotOption, { slotId });
      position = tally.reduce((max, r) => Math.max(max, r.position + 1), 0);
    }
    const id = randomUUID();
    const opt = await this.#audited('bundle_option.add', id, async (cem) => {
      const o = cem.create(BundleSlotOption, {
        id,
        slotId,
        optionProductId: input.optionProductId,
        defaultQuantity: input.defaultQuantity ?? 1,
        position,
      });
      await cem.flush();
      return {
        result: o,
        before: null,
        after: { slotId, optionProductId: input.optionProductId, position },
      };
    });
    return this.toOptionRow(opt);
  }

  async removeOption(
    parentProductId: string,
    slotId: string,
    optionId: string,
  ): Promise<void> {
    await this.#audited('bundle_option.remove', optionId, async (em) => {
      await this.assertBundleParent(em, parentProductId);
      const opt = await em.findOne(BundleSlotOption, { id: optionId, slotId });
      if (!opt) {
        throw new HttpError(
          404,
          ERROR_CODES.BUNDLE_SLOT_OPTION_NOT_FOUND,
          `Bundle slot option "${optionId}" not found.`,
        );
      }
      const before = { slotId, optionProductId: opt.optionProductId };
      em.remove(opt);
      return { result: undefined, before, after: null };
    });
  }

  /**
   * Pure-compute validation of a buyer's bundle configuration. Returns a
   * structured result rather than throwing — the storefront wants the
   * whole error list per-slot so it can highlight every offending row.
   *
   * Throws HttpError 400 only when the parent product is not a bundle
   * (the call doesn't make sense in that case).
   */
  async validateConfiguration(
    parentProductId: string,
    selections: ConfigurationSelection[],
  ): Promise<BundleValidationResult> {
    const em = this.emFactory();
    await this.assertBundleParent(em, parentProductId);
    const slots = await em.find(BundleSlot, { parentProductId });
    const slotIds = slots.map((s) => s.id);
    const options =
      slotIds.length > 0
        ? await em.find(BundleSlotOption, { slotId: { $in: slotIds } })
        : [];
    const slotsById = new Map(slots.map((s) => [s.id, s]));
    const optionsById = new Map(options.map((o) => [o.id, o]));

    const errors: BundleValidationError[] = [];
    const resolvedSelections: BundleValidationResult['resolvedSelections'] = [];

    // Check unknown options + sum quantities per slot.
    const totalBySlot = new Map<string, number>();
    for (const sel of selections) {
      const slot = slotsById.get(sel.slotId);
      const option = optionsById.get(sel.optionId);
      if (!slot || !option || option.slotId !== sel.slotId) {
        errors.push({
          code: 'UNKNOWN_OPTION',
          ...(slot ? { slotId: slot.id } : {}),
          message: `Unknown option ${sel.optionId} in slot ${sel.slotId}.`,
        });
        continue;
      }
      const current = totalBySlot.get(slot.id) ?? 0;
      totalBySlot.set(slot.id, current + sel.quantity);
      resolvedSelections.push({
        slotId: slot.id,
        optionId: option.id,
        optionProductId: option.optionProductId,
        quantity: sel.quantity,
      });
    }

    // Range checks.
    for (const slot of slots) {
      const total = totalBySlot.get(slot.id) ?? 0;
      if (total < slot.minQuantity) {
        errors.push({
          code: 'MIN_NOT_MET',
          slotId: slot.id,
          message: `Slot requires at least ${slot.minQuantity} item(s); got ${total}.`,
        });
      }
      if (total > slot.maxQuantity) {
        errors.push({
          code: 'MAX_EXCEEDED',
          slotId: slot.id,
          message: `Slot allows at most ${slot.maxQuantity} item(s); got ${total}.`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      resolvedSelections,
    };
  }

  private async assertBundleParent(
    em: EntityManager,
    parentProductId: string,
  ): Promise<Product> {
    const parent = await em.findOne(Product, { id: parentProductId });
    if (!parent || parent.deletedAt) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Product "${parentProductId}" not found.`,
      );
    }
    if (parent.type !== 'bundle') {
      throw new HttpError(
        400,
        ERROR_CODES.PRODUCT_TYPE_MISMATCH,
        `Product type is "${parent.type}", expected "bundle".`,
      );
    }
    return parent;
  }

  private toOptionRow(o: BundleSlotOption): BundleSlotOptionRow {
    return {
      id: o.id,
      slotId: o.slotId,
      optionProductId: o.optionProductId,
      defaultQuantity: o.defaultQuantity,
      position: o.position,
    };
  }
}
