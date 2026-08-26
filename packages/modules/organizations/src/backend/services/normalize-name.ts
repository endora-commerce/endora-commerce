/**
 * `normalizeOrganizationName` moved to `@endora-commerce/contracts` in feature 075's
 * Phase P: it is pure over its argument, so a gated port answering 503 to
 * "fold these diacritics" would be a bug rather than a degrade (FR-013).
 *
 * It has to be one implementation, not two — the entity's `@BeforeCreate` /
 * `@BeforeUpdate` hooks write `name_search` with it and `orders`' list filter
 * matches against that column with it, so a copy that drifted would make the
 * filter stop matching silently.
 *
 * Re-exported here for the length of Phase P, which cuts no consumer.
 */
export { normalizeOrganizationName } from '@endora-commerce/contracts';
