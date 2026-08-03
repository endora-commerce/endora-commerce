import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';
import '../../../src/modules/product_feeds/entities/feed-template.entity.js';
import '../../../src/modules/product_feeds/entities/feed-template-field.entity.js';
import '../../../src/modules/product_feeds/entities/product-feed.entity.js';
import '../../../src/modules/product_feeds/entities/feed-run.entity.js';
import '../../../src/modules/product_feeds/entities/feed-run-issue.entity.js';
import '../../../src/modules/product_feeds/entities/feed-artefact.entity.js';
import '../../../src/modules/product_feeds/entities/feed-taxonomy.entity.js';
import '../../../src/modules/product_feeds/entities/feed-taxonomy-node.entity.js';
import '../../../src/modules/product_feeds/entities/feed-taxonomy-mapping.entity.js';
import '../../../src/modules/product_feeds/entities/feed-taxonomy-check.entity.js';

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
  '../../../src/modules/product_feeds/entities',
);

const ENTITIES: ReadonlyArray<[className: string, fileName: string]> = [
  ['FeedTemplate', 'feed-template.entity.ts'],
  ['FeedTemplateField', 'feed-template-field.entity.ts'],
  ['ProductFeed', 'product-feed.entity.ts'],
  ['FeedRun', 'feed-run.entity.ts'],
  ['FeedRunIssue', 'feed-run-issue.entity.ts'],
  ['FeedArtefact', 'feed-artefact.entity.ts'],
  ['FeedTaxonomy', 'feed-taxonomy.entity.ts'],
  ['FeedTaxonomyNode', 'feed-taxonomy-node.entity.ts'],
  ['FeedTaxonomyMapping', 'feed-taxonomy-mapping.entity.ts'],
  ['FeedTaxonomyCheck', 'feed-taxonomy-check.entity.ts'],
];

describe('product_feeds entity tenant classification', () => {
  it.each(ENTITIES.map(([className]) => className))(
    '%s is registered as a global entity',
    (className) => {
      const meta = tenantClassifications().find((c) => c.className === className);
      expect(meta, `${className} carries no tenant-scope classification`).toBeDefined();
      expect(meta?.scope).toBe('global');
    },
  );

  it.each(ENTITIES)('%s declares no tenant key column', (_className, fileName) => {
    const source = readFileSync(join(ENTITY_DIR, fileName), 'utf8');
    expect(source).not.toMatch(/organizationId|organization_id/);
    expect(source).not.toMatch(/customerAccountId|customer_account_id/);
  });
});
