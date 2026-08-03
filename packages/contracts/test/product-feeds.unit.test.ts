import { describe, expect, it } from 'vitest';
import {
  cronExpressionSchema,
  feedFieldSourceCatalogueSchema,
  feedTaxonomyCheckSchema,
  feedTaxonomyRevisionSchema,
  feedTaxonomySourceUrlSchema,
  feedTemplateDocumentSchema,
  feedTemplateDraftSchema,
  feedTemplateFieldWriteSchema,
  productSelectionRuleSchema,
  promoteFeedTaxonomyRevisionRequestSchema,
  timezoneSchema,
  updateFeedTemplateRequestSchema,
  updateProductFeedRequestSchema,
  PRODUCT_FEED_ERROR_CODES,
  PRODUCT_FEED_SETTING_CODES,
  TAXONOMY_FETCH_LIMITS,
  type ProductSelectionRule,
} from '../src/product-feeds.js';

describe('cronExpressionSchema', () => {
  it('accepts the 5-field expressions the schedule presets produce', () => {
    for (const expression of ['0 */4 * * *', '*/15 * * * *', '30 2 * * 1-5']) {
      expect(cronExpressionSchema.parse(expression)).toBe(expression);
    }
  });

  it('rejects a 4-field expression', () => {
    expect(() => cronExpressionSchema.parse('0 */4 * *')).toThrow();
  });

  it('rejects a non-cron string', () => {
    expect(() => cronExpressionSchema.parse('bogus')).toThrow();
  });

  it('rejects a cron-shaped expression longer than 64 characters', () => {
    // Cron-shaped so the regex passes and only the length bound can refuse it.
    const minutes = Array.from({ length: 23 }, (_, i) => String(i)).join(',');
    const tooLong = `${minutes} * * * *`;
    expect(tooLong.length).toBeGreaterThan(64);
    expect(() => cronExpressionSchema.parse(tooLong)).toThrow();
  });
});

describe('timezoneSchema', () => {
  it('accepts an IANA zone the runtime knows', () => {
    expect(timezoneSchema.parse('Europe/Warsaw')).toBe('Europe/Warsaw');
  });

  it('rejects a zone the runtime does not know', () => {
    expect(() => timezoneSchema.parse('Mars/Phobos')).toThrow();
  });
});

describe('productSelectionRuleSchema', () => {
  const condition: ProductSelectionRule = {
    kind: 'condition',
    field: { kind: 'builtin', key: 'status' },
    op: 'eq',
    values: ['active'],
  };

  function nest(depth: number): ProductSelectionRule {
    let node: ProductSelectionRule = condition;
    for (let i = 0; i < depth; i++) {
      node = { kind: 'group', op: 'AND', children: [node] };
    }
    return node;
  }

  it('accepts the canonical whole-catalogue rule', () => {
    expect(productSelectionRuleSchema.parse({ kind: 'all' })).toEqual({ kind: 'all' });
  });

  it('accepts nesting up to depth 5', () => {
    expect(() => productSelectionRuleSchema.parse(nest(5))).not.toThrow();
  });

  it('rejects nesting at depth 6', () => {
    expect(() => productSelectionRuleSchema.parse(nest(6))).toThrow();
  });

  it('rejects a group with 21 children', () => {
    const children = Array.from({ length: 21 }, () => condition);
    expect(() =>
      productSelectionRuleSchema.parse({ kind: 'group', op: 'OR', children }),
    ).toThrow();
  });
});

describe('feedTemplateFieldWriteSchema', () => {
  const base = {
    outputName: 'g:price',
    sourceKind: 'price',
    sortOrder: 0,
  } as const;

  it('accepts a plain source-bound field', () => {
    expect(() => feedTemplateFieldWriteSchema.parse(base)).not.toThrow();
  });

  it('rejects a constant field without a constant value', () => {
    expect(() =>
      feedTemplateFieldWriteSchema.parse({ ...base, sourceKind: 'constant' }),
    ).toThrow();
  });

  it('rejects a constant value on a non-constant field', () => {
    expect(() =>
      feedTemplateFieldWriteSchema.parse({ ...base, constantValue: 'PLN' }),
    ).toThrow();
  });

  it('rejects an attribute field without a source key', () => {
    expect(() =>
      feedTemplateFieldWriteSchema.parse({ ...base, sourceKind: 'attribute' }),
    ).toThrow();
    expect(() =>
      feedTemplateFieldWriteSchema.parse({
        ...base,
        sourceKind: 'custom_field',
        sourceKey: '',
      }),
    ).toThrow();
  });

  it('accepts an attribute field with a source key', () => {
    expect(() =>
      feedTemplateFieldWriteSchema.parse({
        ...base,
        sourceKind: 'attribute',
        sourceKey: 'colour',
      }),
    ).not.toThrow();
  });
});

describe('feedTemplateDocumentSchema', () => {
  const document = {
    formatVersion: 1,
    template: {
      name: 'Google Merchant Center',
      description: null,
      providerCode: 'google_merchant',
      outputFormat: 'xml',
      itemGranularity: 'variant',
      taxonomyProviderCode: 'google_merchant',
      fields: [
        {
          outputName: 'g:id',
          sourceKind: 'sku',
          sourceKey: null,
          constantValue: null,
          fallbackValue: null,
          providerRequired: true,
          transform: null,
          transformArg: null,
          sortOrder: 0,
          helpKey: 'builder.help.id',
        },
      ],
    },
  };

  it('accepts the current format version', () => {
    expect(() => feedTemplateDocumentSchema.parse(document)).not.toThrow();
  });

  it('rejects a future format version', () => {
    expect(() =>
      feedTemplateDocumentSchema.parse({ ...document, formatVersion: 2 }),
    ).toThrow();
  });

  it('rejects a document carrying more fields than a template may hold', () => {
    // An import is untrusted input arriving from another installation. The
    // document's field list must be bounded by the same ceiling the template
    // write schema uses, or a hand-made file could ask the importer to insert
    // an unbounded number of rows in one transaction.
    const field = document.template.fields[0]!;
    const many = Array.from({ length: 201 }, (_, index) => ({
      ...field,
      outputName: `g:field_${index}`,
      sortOrder: index,
    }));
    expect(() =>
      feedTemplateDocumentSchema.parse({
        ...document,
        template: { ...document.template, fields: many },
      }),
    ).toThrow();
  });
});

describe('feedTemplateDraftSchema', () => {
  it('accepts an unsaved draft carrying no id and an unresolvable source key', () => {
    const draft = {
      providerCode: 'custom',
      outputFormat: 'csv',
      itemGranularity: 'product',
      taxonomyProviderCode: null,
      fields: [
        {
          outputName: 'colour',
          sourceKind: 'attribute',
          // Not a definition that exists locally — a field-level fact the
          // preview reports (FR-015, FR-072), never a schema error.
          sourceKey: 'not_a_local_definition',
          sortOrder: 0,
        },
      ],
    };
    const parsed = feedTemplateDraftSchema.parse(draft);
    expect(parsed.fields).toHaveLength(1);
    expect(parsed).not.toHaveProperty('id');
  });
});

describe('updateProductFeedRequestSchema', () => {
  it('injects no defaults — a PATCH carries only what the operator changed', () => {
    // `z.object().partial()` makes a key optional but keeps its `.default()`,
    // so a naive `.partial()` would turn "rename this feed" into "…and switch
    // it to gross prices, reset its criteria and drop its schedule".
    const parsed = updateProductFeedRequestSchema.parse({ name: 'Renamed' });
    expect(parsed).toEqual({ name: 'Renamed' });
    expect(parsed).not.toHaveProperty('pricePresentation');
    expect(parsed).not.toHaveProperty('selectionRule');
    expect(parsed).not.toHaveProperty('schedule');
    expect(parsed).not.toHaveProperty('enabled');
  });

  it('still accepts every field when they are sent explicitly', () => {
    const parsed = updateProductFeedRequestSchema.parse({
      pricePresentation: 'net',
      selectionRule: { kind: 'all' },
      schedule: { cron: '0 */4 * * *', timezone: 'Europe/Warsaw' },
      enabled: false,
    });
    expect(parsed.pricePresentation).toBe('net');
    expect(parsed.enabled).toBe(false);
    expect(parsed.schedule).toEqual({ cron: '0 */4 * * *', timezone: 'Europe/Warsaw' });
  });
});

describe('updateFeedTemplateRequestSchema', () => {
  it('injects no defaults — the same `.partial()` trap as the feed PATCH', () => {
    // Identical to the feed regression above, and worse in its effect: a save
    // that only renamed a template would have silently rewritten a Google XML
    // per-variant template into a `custom` XML per-product one.
    const parsed = updateFeedTemplateRequestSchema.parse({ name: 'Renamed' });
    expect(parsed).toEqual({ name: 'Renamed' });
    expect(parsed).not.toHaveProperty('providerCode');
    expect(parsed).not.toHaveProperty('outputFormat');
    expect(parsed).not.toHaveProperty('itemGranularity');
    expect(parsed).not.toHaveProperty('fields');
  });

  it('keeps the whole-list save when `fields` is sent explicitly', () => {
    const parsed = updateFeedTemplateRequestSchema.parse({
      providerCode: 'google_merchant',
      outputFormat: 'xml',
      itemGranularity: 'variant',
      fields: [{ outputName: 'g:id', sourceKind: 'sku', sortOrder: 0 }],
    });
    expect(parsed.providerCode).toBe('google_merchant');
    expect(parsed.fields).toHaveLength(1);
  });

  it('accepts an explicitly emptied field list — that is a real edit', () => {
    const parsed = updateFeedTemplateRequestSchema.parse({ fields: [] });
    expect(parsed.fields).toEqual([]);
  });
});

describe('feedFieldSourceCatalogueSchema', () => {
  it('accepts the guided binding catalogue the editor renders (FR-070)', () => {
    const parsed = feedFieldSourceCatalogueSchema.parse({
      groups: [
        {
          kind: 'product_property',
          sources: [
            { sourceKind: 'sku', sourceKey: null, labelKey: 'fieldSource.sku', label: null },
          ],
        },
        {
          kind: 'attribute',
          sources: [
            {
              sourceKind: 'attribute',
              sourceKey: 'brand',
              labelKey: null,
              label: 'Brand',
              valueType: 'select',
            },
          ],
        },
        {
          kind: 'computed',
          sources: [
            {
              sourceKind: 'provider_category',
              sourceKey: null,
              labelKey: 'fieldSource.providerCategory',
              label: null,
              requiresTaxonomy: true,
            },
          ],
        },
      ],
    });
    expect(parsed.groups).toHaveLength(3);
    expect(parsed.groups[1]?.sources[0]?.sourceKey).toBe('brand');
  });

  it('refuses a source outside the closed `sourceKind` catalogue', () => {
    const parsed = feedFieldSourceCatalogueSchema.safeParse({
      groups: [{ kind: 'computed', sources: [{ sourceKind: 'liquid_expression' }] }],
    });
    expect(parsed.success).toBe(false);
  });
});

/**
 * Feature 067 Phase 11 / T118 — the taxonomy revision refresh shapes
 * (FR-086 – FR-099). The invariant every one of them serves: a check may only
 * ADD an inactive revision, so there is a `promote` request schema and no
 * `activate` flag anywhere else.
 */
describe('taxonomy revision refresh contracts (FR-086 – FR-099)', () => {
  const revision = {
    id: '11111111-1111-4111-8111-111111111111',
    providerCode: 'google_merchant',
    revision: '2026-05-14',
    isCurrent: false,
    nodeCount: 4782,
    source: 'fetched',
    sourceUrls: { en: 'https://example.test/en.txt', pl: 'https://example.test/pl.txt' },
    installedAt: '2026-05-14T04:00:00.000Z',
    fetchedAt: '2026-05-14T04:00:00.000Z',
    promotedAt: null,
    supersededAt: null,
    flags: ['shrink'],
  };

  it('accepts a fetched revision and defaults `sourceUrls` / `flags`', () => {
    expect(feedTaxonomyRevisionSchema.parse(revision).flags).toEqual(['shrink']);
    const bundled = feedTaxonomyRevisionSchema.parse({
      ...revision,
      source: 'bundled',
      sourceUrls: undefined,
      fetchedAt: null,
      flags: undefined,
    });
    expect(bundled.sourceUrls).toEqual({});
    expect(bundled.flags).toEqual([]);
  });

  it('refuses a source outside {bundled, fetched} and an unknown flag', () => {
    expect(feedTaxonomyRevisionSchema.safeParse({ ...revision, source: 'uploaded' }).success).toBe(
      false,
    );
    expect(feedTaxonomyRevisionSchema.safeParse({ ...revision, flags: ['grew'] }).success).toBe(
      false,
    );
  });

  it('requires the impact acknowledgement on promote (FR-095)', () => {
    expect(promoteFeedTaxonomyRevisionRequestSchema.safeParse({}).success).toBe(false);
    expect(
      promoteFeedTaxonomyRevisionRequestSchema.parse({ expectedStaleMappingCount: 0 })
        .expectedStaleMappingCount,
    ).toBe(0);
  });

  it('keeps the check outcome and reason vocabularies closed', () => {
    const check = {
      id: '22222222-2222-4222-8222-222222222222',
      providerCode: 'meta',
      trigger: 'scheduled',
      startedAt: '2026-05-14T04:00:00.000Z',
      finishedAt: null,
      outcome: null,
      reason: null,
      detail: null,
      httpStatus: null,
      bytesRead: null,
      contentHash: null,
      installedTaxonomyId: null,
    };
    expect(feedTaxonomyCheckSchema.parse(check).outcome).toBeNull();
    expect(feedTaxonomyCheckSchema.safeParse({ ...check, outcome: 'promoted' }).success).toBe(false);
    expect(feedTaxonomyCheckSchema.safeParse({ ...check, reason: 'firewall' }).success).toBe(false);
    expect(
      feedTaxonomyCheckSchema.safeParse({ ...check, outcome: 'rejected', reason: 'too_large' })
        .success,
    ).toBe(true);
  });

  it('refuses a source URL that is not credential-free https without a fragment (FR-091)', () => {
    expect(feedTaxonomySourceUrlSchema.safeParse('https://example.test/en.txt').success).toBe(true);
    for (const bad of [
      'http://example.test/en.txt',
      'https://user:pass@example.test/en.txt',
      'https://example.test/en.txt#frag',
      'ftp://example.test/en.txt',
      'not a url',
    ]) {
      expect(feedTaxonomySourceUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('carries the four new error codes and the eight new setting codes', () => {
    expect(PRODUCT_FEED_ERROR_CODES.TAXONOMY_FETCH_DISABLED).toBe('taxonomy_fetch_disabled');
    expect(PRODUCT_FEED_ERROR_CODES.TAXONOMY_CHECK_IN_PROGRESS).toBe('taxonomy_check_in_progress');
    expect(PRODUCT_FEED_ERROR_CODES.IMPACT_CHANGED).toBe('impact_changed');
    expect(PRODUCT_FEED_ERROR_CODES.TAXONOMY_REVISION_ALREADY_CURRENT).toBe(
      'taxonomy_revision_already_current',
    );
    expect(PRODUCT_FEED_SETTING_CODES.TAXONOMY_FETCH_ENABLED).toBe(
      'product_feeds.taxonomy_fetch_enabled',
    );
    expect(PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_META_PL).toBe(
      'product_feeds.taxonomy_source_url_meta_pl',
    );
  });

  it('keeps the egress limits as constants, not settings (FR-091)', () => {
    expect(TAXONOMY_FETCH_LIMITS.MAX_REDIRECTS).toBe(3);
    expect(TAXONOMY_FETCH_LIMITS.MAX_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
    expect(TAXONOMY_FETCH_LIMITS.MIN_PLAUSIBLE_NODES).toBe(500);
    // No operator-writable setting may widen an SSRF guard: none of the egress
    // limits above is reachable through a `product_feeds.*` setting code.
    expect(
      Object.values(PRODUCT_FEED_SETTING_CODES).some((code) =>
        /request_timeout|redirect|response_bytes|plausible/.test(code),
      ),
    ).toBe(false);
  });
});
