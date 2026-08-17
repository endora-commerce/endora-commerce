/**
 * Feature 022 — scope flags for the **system** product attributes that are NOT
 * rows in `product_attributes` (and therefore do not carry their own DB-stored
 * scope flags).
 *
 * All four declarations moved to `@b2b/contracts` in feature 075's Phase P
 * (FR-013). `SYSTEM_ATTRIBUTE_SCOPES` is a constant and `getAttributeScope` a
 * pure function over it: `name` and `description` are channel- and
 * language-scoped because the product table stores them as per-locale JSONB,
 * which is a fact about the schema rather than about whether a module is
 * switched on. A gated port answering 503 to "is this key channel-scoped"
 * would be a bug.
 *
 * Re-exported here for the length of Phase P, which cuts no consumer —
 * `search`'s indexer still names this path.
 */
export {
  SYSTEM_ATTRIBUTE_SCOPES,
  type SystemAttributeKey,
  isSystemAttributeKey,
  getAttributeScope,
} from '@b2b/contracts';
