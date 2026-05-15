import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { Product } from '../entities/product.entity.js';
import { ProductAttribute } from '../entities/product-attribute.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import { getAttributeScope, isSystemAttributeKey } from './system-attribute-scopes.js';

/**
 * Feature 022 — channel-aware value-override CRUD.
 *
 * The bulk upsert+delete handler is the only mutator; it runs all
 * operations in one MikroORM transaction so a single 422 rolls back
 * every requested change (FR-030 atomicity).
 *
 * Validation rules (data-model.md §3.3 + §4):
 *   - `attribute_unknown`            — key is neither a system attr nor a
 *                                       product_attributes.key row.
 *   - `attribute_not_channel_scoped` — caller wrote to a (channel, ...)
 *                                       slot for an attr that has
 *                                       channelScoped=false.
 *   - `attribute_missing_language`   — caller wrote (channel, null) for
 *                                       an attr that has languageScoped=
 *                                       true (must address a specific
 *                                       language slot).
 *   - `channel_not_assigned_to_product` — channel is not in the
 *                                       product's membership set.
 *   - `language_not_in_channel`      — language is not in the channel's
 *                                       SalesChannel.languages array.
 *   - `value_invalid`                — value shape does not satisfy the
 *                                       attribute's valueType.
 */

export type OverrideUpsertInput = {
  attributeKey: string;
  channelId: string;
  languageCode: string | null;
  value: { v: unknown };
};

export type OverrideDeleteInput = {
  attributeKey: string;
  channelId: string;
  languageCode: string | null;
};

export type ApplyOverridesInput = {
  upserts: readonly OverrideUpsertInput[];
  deletes: readonly OverrideDeleteInput[];
};

export type ApplyOverridesResult = {
  productId: string;
  applied: { upserted: number; deleted: number };
  overrides: ProductValueOverride[];
};

export class ProductOverridesService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly salesChannelMembership: SalesChannelMembershipService,
  ) {}

  async listForProduct(productId: string): Promise<ProductValueOverride[]> {
    const em = this.emFactory();
    return em.find(ProductValueOverride, { productId });
  }

  /**
   * Validate + apply a bulk write. All operations run in one
   * transaction. The first validation failure aborts everything; the
   * thrown HttpError carries the offending input's index in `issues`
   * so callers can highlight the bad row.
   */
  async applyBulk(productId: string, input: ApplyOverridesInput): Promise<ApplyOverridesResult> {
    const em = this.emFactory();

    const product = await em.findOne(Product, { id: productId });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    // Collect referenced channels + attribute rows in one fetch each.
    const channelIds = Array.from(
      new Set([
        ...input.upserts.map((u) => u.channelId),
        ...input.deletes.map((d) => d.channelId),
      ]),
    );
    const channels =
      channelIds.length === 0
        ? []
        : await em.find(SalesChannel, { id: { $in: channelIds } });
    const channelById = new Map(channels.map((c) => [c.id, c]));

    const attrKeys = Array.from(
      new Set([
        ...input.upserts.map((u) => u.attributeKey),
        ...input.deletes.map((d) => d.attributeKey),
      ]),
    ).filter((k) => !isSystemAttributeKey(k));
    const attrRows =
      attrKeys.length === 0
        ? []
        : await em.find(ProductAttribute, { key: { $in: attrKeys } });
    const attrByKey = new Map(attrRows.map((r) => [r.key, r]));

    const assignedChannels = await this.salesChannelMembership.listChannelsForEntity(
      'product',
      productId,
    );
    const assignedChannelIds = new Set(assignedChannels.map((c) => c.id));

    // Run validation first; if anything throws, we abort before mutating.
    const validateEntry = (
      kind: 'upsert' | 'delete',
      idx: number,
      e: OverrideUpsertInput | OverrideDeleteInput,
    ): void => {
      const pathPrefix = `${kind === 'upsert' ? 'upserts' : 'deletes'}[${idx}]`;
      const attrRow = attrByKey.get(e.attributeKey);
      if (!isSystemAttributeKey(e.attributeKey) && !attrRow) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'attribute_unknown',
          [{ path: `${pathPrefix}.attributeKey`, issue: e.attributeKey }],
        );
      }
      const scope = getAttributeScope(e.attributeKey, attrRow ?? null);
      if (!scope.channelScoped) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'attribute_not_channel_scoped',
          [{ path: `${pathPrefix}.attributeKey`, issue: e.attributeKey }],
        );
      }
      if (scope.languageScoped && e.languageCode === null) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'attribute_missing_language',
          [{ path: `${pathPrefix}.languageCode`, issue: 'null' }],
        );
      }
      if (!assignedChannelIds.has(e.channelId)) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'channel_not_assigned_to_product',
          [{ path: `${pathPrefix}.channelId`, issue: e.channelId }],
        );
      }
      const channel = channelById.get(e.channelId);
      if (e.languageCode !== null) {
        if (!channel || !channel.languages.includes(e.languageCode)) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            'language_not_in_channel',
            [{ path: `${pathPrefix}.languageCode`, issue: e.languageCode }],
          );
        }
      }
      if (kind === 'upsert') {
        const u = e as OverrideUpsertInput;
        validateValueShape(
          u.value.v,
          attrRow?.valueType ?? 'string',
          `${pathPrefix}.value`,
        );
      }
    };

    input.upserts.forEach((u, i) => validateEntry('upsert', i, u));
    input.deletes.forEach((d, i) => validateEntry('delete', i, d));

    // Apply in one transaction.
    let upserted = 0;
    let deleted = 0;
    await em.transactional(async (tem) => {
      for (const u of input.upserts) {
        const where = {
          productId,
          attributeKey: u.attributeKey,
          channelId: u.channelId,
          languageCode: u.languageCode ?? null,
        } as const;
        const existing = await tem.findOne(ProductValueOverride, where);
        if (existing) {
          existing.value = u.value;
          // Touch flush; updatedAt hook handles the rest.
        } else {
          tem.persist(
            tem.create(ProductValueOverride, {
              productId,
              attributeKey: u.attributeKey,
              channelId: u.channelId,
              languageCode: u.languageCode,
              value: u.value,
            }),
          );
        }
        upserted += 1;
      }
      for (const d of input.deletes) {
        const existing = await tem.findOne(ProductValueOverride, {
          productId,
          attributeKey: d.attributeKey,
          channelId: d.channelId,
          languageCode: d.languageCode ?? null,
        });
        if (existing) {
          tem.remove(existing);
          deleted += 1;
        }
      }
      await tem.flush();
    });

    const all = await em.find(ProductValueOverride, { productId });
    return { productId, applied: { upserted, deleted }, overrides: all };
  }
}

/**
 * Minimal value-shape check. Allows null (clearing); otherwise enforces
 * a primitive shape consistent with the attribute's valueType. Stricter
 * validation (enum option membership, price decimals, date format) is
 * deferred — the existing attribute-write path in catalog-admin.service
 * does the strict pass when the value lands in the global baseline, and
 * the override path can lean on that until a follow-up centralises the
 * rule.
 */
function validateValueShape(v: unknown, valueType: string, path: string): void {
  if (v === null || v === undefined) return;
  const fail = (issue: string): never => {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'value_invalid', [
      { path, issue },
    ]);
  };
  switch (valueType) {
    case 'string':
    case 'enum':
    case 'select':
      if (typeof v !== 'string') return fail(`expected string, got ${typeof v}`);
      return;
    case 'number':
    case 'price':
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return fail(`expected finite number, got ${typeof v}`);
      }
      return;
    case 'boolean':
      if (typeof v !== 'boolean') return fail(`expected boolean, got ${typeof v}`);
      return;
    case 'date':
      if (typeof v !== 'string') return fail(`expected ISO-date string, got ${typeof v}`);
      return;
    case 'multiselect':
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
        return fail('expected string[]');
      }
      return;
    default:
      // Unknown value types pass through; the legacy storage path will
      // reject anything pathological.
      return;
  }
}
