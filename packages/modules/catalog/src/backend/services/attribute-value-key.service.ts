import type { EntityManager } from '@mikro-orm/postgresql';
import { customFieldDefinitionSchema, isSystemAttributeKey } from '@endora-commerce/contracts';
import type {
  CatalogAttributeValueKeyApi,
  CatalogAttributeValueKeyMove,
  CatalogAttributeValueKeyRenameOptions,
  CatalogDisplacedAttributeValue,
  CatalogDisplacedValueOverride,
} from '../../ports/index.js';

/**
 * A value-key rename `catalog` refused before writing anything.
 *
 * `system_attribute` — `name` and `description` are product columns, not
 * attribute values, and an override row carrying one of them is a slot of the
 * product's own field; neither can be the source or the target of a key move.
 * `invalid_key` — outside the grammar every product attribute key satisfies.
 * `target_occupied` — the caller asked to `refuse` and data is already stored
 * under the destination.
 */
export class AttributeValueKeyError extends Error {
  constructor(
    readonly code: 'system_attribute' | 'invalid_key' | 'target_occupied',
    message: string,
  ) {
    super(message);
    this.name = 'AttributeValueKeyError';
  }
}

interface DestinationValueRow {
  readonly product_id: string;
  readonly value: unknown;
}

interface DestinationOverrideRow {
  readonly product_id: string;
  readonly channel_id: string;
  readonly language_code: string | null;
  readonly value: unknown;
}

/**
 * Renames an attribute's **value key** everywhere `catalog` stores it as a
 * string (`specs/134-paid-module-extraction/research.md` D12, *Ergonode
 * fallback boundary* and *what a rename does to data already under its
 * destination*).
 *
 * Two places, and only two: `products.attribute_values`, a JSONB map keyed by
 * the attribute key, and `product_value_overrides.attribute_key`. Everything
 * else in the catalogue points at an attribute by id. The definition's own key
 * is `custom_fields`' row and is renamed through its `applyRenameKey`, in the
 * same transaction as this call — which is why this takes the caller's
 * `EntityManager` and runs every statement on its transaction context rather
 * than on a connection of its own.
 *
 * In order, all on that transaction:
 *
 *   1. the destination's baseline values and override rows are read and
 *      locked (`for update`);
 *   2. if there are any, `refuse` throws `target_occupied` — nothing has been
 *      written — and `displace` strips the key from those products and deletes
 *      those override rows, keeping what it removed to return;
 *   3. the two moves run. The destination is empty by now, so the `jsonb ||`
 *      in the first one only adds a key and the second can meet no unique
 *      index — the result does not depend on which products held what.
 *
 * No command, no audit, no cache publish: the caller's composite operation owns
 * those, exactly as for `custom_fields`' apply seam.
 */
export class AttributeValueKeyService implements CatalogAttributeValueKeyApi {
  async renameValueKey(
    em: EntityManager,
    fromKey: string,
    toKey: string,
    options: CatalogAttributeValueKeyRenameOptions,
  ): Promise<CatalogAttributeValueKeyMove> {
    for (const key of [fromKey, toKey]) {
      if (isSystemAttributeKey(key)) {
        throw new AttributeValueKeyError(
          'system_attribute',
          `"${key}" is a product field, not an attribute value key; nothing was renamed.`,
        );
      }
      if (!customFieldDefinitionSchema.shape.key.safeParse(key).success) {
        throw new AttributeValueKeyError('invalid_key', `"${key}" is not a valid attribute key.`);
      }
    }
    if (fromKey === toKey) {
      return { products: 0, overrides: 0, displaced: { values: [], overrides: [] } };
    }

    // command-coverage-ignore: owner-published rename seam — runs on the caller's
    // transactional EM. Its one caller is a system-invariant repair with no
    // operator and no actor (a connector re-keying the attributes it derived,
    // committed atomically with `custom_fields`' definition rename and the
    // connector's own repair checkpoint); an audit entry for it would have
    // nobody to attribute. Contract: specs/134-paid-module-extraction/research.md D12.
    const connection = em.getConnection();
    const ctx = em.getTransactionContext();

    const occupiedValues = (await connection.execute(
      `select "id" as product_id, "attribute_values" -> ?::text as value
         from "products"
        where jsonb_exists("attribute_values", ?::text)
        for update`,
      [toKey, toKey],
      'all',
      ctx,
    )) as DestinationValueRow[];
    const occupiedOverrides = (await connection.execute(
      `select "product_id", "channel_id", "language_code", "value"
         from "product_value_overrides"
        where "attribute_key" = ?
        for update`,
      [toKey],
      'all',
      ctx,
    )) as DestinationOverrideRow[];

    let displacedValues: CatalogDisplacedAttributeValue[] = [];
    let displacedOverrides: CatalogDisplacedValueOverride[] = [];
    if (occupiedValues.length > 0 || occupiedOverrides.length > 0) {
      if (options.occupied === 'refuse') {
        throw new AttributeValueKeyError(
          'target_occupied',
          `"${toKey}" already holds ${occupiedValues.length} product value(s) and ` +
            `${occupiedOverrides.length} override row(s); nothing was renamed.`,
        );
      }
      if (occupiedValues.length > 0) {
        await connection.execute(
          `update "products" set "attribute_values" = "attribute_values" - ?::text
            where jsonb_exists("attribute_values", ?::text)`,
          [toKey, toKey],
          'run',
          ctx,
        );
        displacedValues = occupiedValues.map((row) => ({
          productId: row.product_id,
          value: row.value,
        }));
      }
      if (occupiedOverrides.length > 0) {
        const removed = (await connection.execute(
          `delete from "product_value_overrides" where "attribute_key" = ?
            returning "product_id", "channel_id", "language_code", "value"`,
          [toKey],
          'all',
          ctx,
        )) as DestinationOverrideRow[];
        displacedOverrides = removed.map((row) => ({
          productId: row.product_id,
          channelId: row.channel_id,
          languageCode: row.language_code,
          value: row.value,
        }));
      }
    }

    const products = await connection.execute(
      `update "products"
          set "attribute_values" = ("attribute_values" - ?::text) || jsonb_build_object(?::text, "attribute_values" -> ?::text)
        where jsonb_exists("attribute_values", ?::text)`,
      [fromKey, toKey, fromKey, fromKey],
      'run',
      ctx,
    );
    const overrides = await connection.execute(
      `update "product_value_overrides" set "attribute_key" = ? where "attribute_key" = ?`,
      [toKey, fromKey],
      'run',
      ctx,
    );
    return {
      products: affectedRowsOf(products),
      overrides: affectedRowsOf(overrides),
      displaced: { values: displacedValues, overrides: displacedOverrides },
    };
  }
}

function affectedRowsOf(result: unknown): number {
  const affected = (result as { affectedRows?: unknown } | null)?.affectedRows;
  return typeof affected === 'number' ? affected : 0;
}
