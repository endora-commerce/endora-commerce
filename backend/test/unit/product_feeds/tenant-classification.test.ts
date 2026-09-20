import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';
// The **published** array, not twelve side-effect imports of the package's
// source. Both would run the decorators, and that is exactly the problem: a
// source-reached entity class is a *second* class object beside the one the
// ORM registered out of this array (D-160.6.1). Naming the array is also what
// makes the coverage assertion real: it is the same array
// `db/entities-registry.generated.ts` spreads.
import { entities } from '@endora-commerce/mod-product-feeds/backend';

/**
 * Feature 067 / data-model.md §0 — every Product Feed entity is
 * `@GlobalEntity()` (Principle XI).
 *
 * A feed is platform-level operator configuration over global catalogue data,
 * published anonymously; FR-061 forbids it from ever rendering an
 * organization's negotiated prices, so there is no organization dimension to
 * scope by, and inventing one would make the anonymous public route
 * unresolvable. The comparable entities — `SalesChannel`, `Product`,
 * `CustomFieldDefinition`, `Asset` — are all global too.
 *
 * The taxonomy entities (data-model §§8–10, §14) are on the same rule: a
 * provider taxonomy, the operator's category mapping and the history of the
 * checks that looked for a newer revision are all installation-wide reference
 * data and operational history, with no tenant dimension to scope by.
 */

const ENTITY_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/modules/product_feeds/src/backend/entities',
);

const ENTITIES: ReadonlyArray<[className: string, fileName: string]> = [
  ['FeedTemplate', 'feed-template.entity.ts'],
  ['FeedTemplateField', 'feed-template-field.entity.ts'],
  ['ProductFeed', 'product-feed.entity.ts'],
  ['FeedRun', 'feed-run.entity.ts'],
  ['FeedRunIssue', 'feed-run-issue.entity.ts'],
  ['FeedArtefact', 'feed-artefact.entity.ts'],
  ['FeedDelivery', 'feed-delivery.entity.ts'],
  ['FeedDeliveryAttempt', 'feed-delivery-attempt.entity.ts'],
  ['FeedTaxonomy', 'feed-taxonomy.entity.ts'],
  ['FeedTaxonomyNode', 'feed-taxonomy-node.entity.ts'],
  ['FeedTaxonomyMapping', 'feed-taxonomy-mapping.entity.ts'],
  ['FeedTaxonomyCheck', 'feed-taxonomy-check.entity.ts'],
];

/** The five decorators of `packages/platform/src/tenancy/org-scoped.decorator.ts`. */
const CLASSIFICATION_DECORATORS = [
  'OrgScoped',
  'CustomerScoped',
  'GlobalEntity',
  'TransitivelyScoped',
  'RuleScoped',
];

describe('product_feeds entity tenant classification', () => {
  it('covers every entity the package publishes', () => {
    // Two-way, against the package's own `entities` array rather than against a
    // hand-written census. The list above named ten classes while the package
    // published twelve — `FeedDelivery` and `FeedDeliveryAttempt` were
    // classified by nothing here — which is exactly the way a spelled census
    // goes stale.
    const declared = ENTITIES.map(([className]) => className).sort();
    const published = entities.map((cls) => cls.name).sort();
    expect(declared).toEqual(published);
    expect(new Set(ENTITIES.map(([, fileName]) => fileName)).size).toBe(ENTITIES.length);
  });

  it.each(ENTITIES.map(([className]) => className))(
    '%s is registered as a global entity',
    (className) => {
      const meta = tenantClassifications().find((c) => c.className === className);
      expect(meta, `${className} carries no tenant-scope classification`).toBeDefined();
      expect(meta?.scope).toBe('global');
    },
  );

  it.each(ENTITIES)('%s applies exactly one classification decorator', (_className, fileName) => {
    const source = readFileSync(join(ENTITY_DIR, fileName), 'utf8');
    const applied = CLASSIFICATION_DECORATORS.filter((name) =>
      new RegExp(`^@${name}\\(`, 'm').test(source),
    );
    expect(applied).toEqual(['GlobalEntity']);
  });

  it.each(ENTITIES)('%s declares no tenant key column', (_className, fileName) => {
    const source = readFileSync(join(ENTITY_DIR, fileName), 'utf8');
    expect(source).not.toMatch(/organizationId|organization_id/);
    expect(source).not.toMatch(/customerAccountId|customer_account_id/);
  });
});
