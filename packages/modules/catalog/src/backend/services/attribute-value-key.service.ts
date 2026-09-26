import type { EntityManager } from '@mikro-orm/postgresql';
import { customFieldDefinitionSchema, isSystemAttributeKey } from '@endora-commerce/contracts';
import type {
  CatalogAttributeValueKeyApi,
  CatalogAttributeValueKeyMove,
} from '../../ports/index.js';

/**
 * A value-key rename `catalog` refused before issuing a statement.
 *
 * `system_attribute` — `name` and `description` are product columns, not
 * attribute values, and an override row carrying one of them is a slot of the
 * product's own field; neither can be the source or the target of a key move.
 * `invalid_key` — outside the grammar every product attribute key satisfies.
 */
export class AttributeValueKeyError extends Error {
  constructor(
    readonly code: 'system_attribute' | 'invalid_key',
    message: string,
  ) {
    super(message);
    this.name = 'AttributeValueKeyError';
  }
}

/**
 * Renames an attribute's **value key** everywhere `catalog` stores it as a
 * string (`specs/134-paid-module-extraction/research.md` D12, *Ergonode
 * fallback boundary*).
 *
 * Two places, and only two: `products.attribute_values`, a JSONB map keyed by
 * the attribute key, and `product_value_overrides.attribute_key`. Everything
 * else in the catalogue points at an attribute by id. The definition's own key
 * is `custom_fields`' row and is renamed through its `applyRenameKey`, in the
 * same transaction as this call — which is why this takes the caller's
 * `EntityManager` and runs every statement on its transaction context rather
 * than on a connection of its own.
 *
 * Both statements are conditioned on the old key, so re-running one is a no-op.
 * A product carrying **both** keys keeps the moved value under the new one; a
 * dormant value left under the target by a deleted definition is overwritten,
 * which is what `jsonb ||` means and what the historical migration did.
 *
 * No command, no audit, no cache publish: the caller's composite operation owns
 * those, exactly as for `custom_fields`' apply seam.
 */
export class AttributeValueKeyService implements CatalogAttributeValueKeyApi {
  async renameValueKey(
    em: EntityManager,
    fromKey: string,
    toKey: string,
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
    if (fromKey === toKey) return { products: 0, overrides: 0 };

    // command-coverage-ignore: owner-published rename seam — runs on the caller's
    // transactional EM. Its one caller is a system-invariant repair with no
    // operator and no actor (a connector re-keying the attributes it derived,
    // committed atomically with `custom_fields`' definition rename and the
    // connector's own repair checkpoint); an audit entry for it would have
    // nobody to attribute. Contract: specs/134-paid-module-extraction/research.md D12.
    const connection = em.getConnection();
    const ctx = em.getTransactionContext();
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
    };
  }
}

function affectedRowsOf(result: unknown): number {
  const affected = (result as { affectedRows?: unknown } | null)?.affectedRows;
  return typeof affected === 'number' ? affected : 0;
}
