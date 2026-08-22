import { describe, expect, it } from 'vitest';
import type { ApplicationRule, PriceListResolutionContext } from '@endora-commerce/contracts';
import { evaluateApplicationRule } from '@endora-commerce/contracts';
import {
  buildCandidateVector,
  MAX_CATEGORY_CRITERIA_PER_RULE,
  UnorderableRuleError,
  type CandidateListInput,
  type CandidateViewerContext,
} from '../../../src/modules/price_lists/services/price-list-candidate-vector.js';
import {
  pickPriorityChain,
  type PriceListCandidate,
} from '../../../src/modules/price_lists/services/price-list-resolver.js';

/**
 * Feature 086, Phase A gate — the candidate vector's order **is**
 * `pickPriorityChain`'s walk.
 *
 * The whole design rests on one claim: the resolution's fall-through can be
 * expressed as a merge of ordered streams because the priority chain is a total
 * order and removing elements from a total order does not reorder the rest. So
 * the test asserts the property rather than the implementation — for a given
 * product it walks `pickPriorityChain` the way `pickAndResolveBracketsForSet`
 * does, dropping the winner each round, and compares that sequence to the
 * vector filtered to the candidates that apply to the product.
 *
 * Written against generated inputs rather than three hand-built fixtures,
 * because the property has to hold for rules the author did not think of.
 */

const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';
const GROUP = '00000000-0000-4000-8000-0000000000b1';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';
const CAT_A = '00000000-0000-4000-8000-0000000000e1';
const CAT_B = '00000000-0000-4000-8000-0000000000e2';

const viewer: CandidateViewerContext = {
  organizationId: ORG,
  organizationChain: [ORG],
  customerGroupId: GROUP,
  salesChannelId: CHANNEL,
  currencyCode: 'PLN',
};

function list(
  id: string,
  applicationRule: ApplicationRule,
  overrides: Partial<CandidateListInput> = {},
): CandidateListInput {
  return {
    id,
    type: 'base',
    applicationRule,
    modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    name: id,
    isSystem: false,
    ...overrides,
  };
}

/** The walk `pickAndResolveBracketsForSet` performs, for one product. */
function walkForProduct(
  lists: readonly CandidateListInput[],
  productCategoryIds: ReadonlySet<string>,
  partition: 'base' | 'sale',
): string[] {
  const ctx: PriceListResolutionContext = {
    organizationId: viewer.organizationId,
    organizationChain: viewer.organizationChain,
    customerGroupId: viewer.customerGroupId,
    salesChannelId: viewer.salesChannelId,
    currencyCode: viewer.currencyCode,
    productCategoryIds,
  };
  const candidates: Array<PriceListCandidate<CandidateListInput>> = [];
  for (const entry of lists) {
    if (entry.type !== partition) continue;
    const evaluation = evaluateApplicationRule(entry.applicationRule, ctx);
    if (!evaluation.matched) continue;
    candidates.push({
      list: entry,
      evaluation,
      modifiedAt: entry.modifiedAt,
      name: entry.name,
      isSystem: entry.isSystem,
    });
  }
  const order: string[] = [];
  const remaining = [...candidates];
  while (remaining.length > 0) {
    const picked = pickPriorityChain(remaining);
    if (!picked) break;
    order.push(picked.list.id);
    remaining.splice(remaining.indexOf(picked), 1);
  }
  return order;
}

/** The vector, narrowed to the candidates that apply to a product's categories. */
function vectorForProduct(
  lists: readonly CandidateListInput[],
  productCategoryIds: ReadonlySet<string>,
  partition: 'base' | 'sale',
): string[] {
  const applicable = buildCandidateVector(lists, viewer).filter(
    (candidate) =>
      candidate.isSale === (partition === 'sale') &&
      candidate.requireAnyOf.every((group) => group.some((id) => productCategoryIds.has(id))),
  );
  // The merge takes the first candidate that prices a product, so a list named
  // twice is answered by its better-ranked entry; de-duplicate the same way.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of applicable) {
    if (seen.has(candidate.priceListId)) continue;
    seen.add(candidate.priceListId);
    out.push(candidate.priceListId);
  }
  return out;
}

const RULES: Record<string, ApplicationRule> = {
  all: { kind: 'all' },
  channel: { kind: 'criterion', type: 'salesChannel', values: [CHANNEL] },
  org: { kind: 'criterion', type: 'organization', values: [ORG] },
  otherOrg: { kind: 'criterion', type: 'organization', values: [OTHER_ORG] },
  group: { kind: 'criterion', type: 'customerGroup', values: [GROUP] },
  catA: { kind: 'criterion', type: 'category', values: [CAT_A] },
  catAB: { kind: 'criterion', type: 'category', values: [CAT_A, CAT_B] },
  currency: { kind: 'criterion', type: 'currency', values: ['PLN'] },
  andCatChannel: {
    kind: 'group',
    op: 'AND',
    children: [
      { kind: 'criterion', type: 'category', values: [CAT_A] },
      { kind: 'criterion', type: 'salesChannel', values: [CHANNEL] },
    ],
  },
  orCatChannel: {
    kind: 'group',
    op: 'OR',
    children: [
      { kind: 'criterion', type: 'category', values: [CAT_B] },
      { kind: 'criterion', type: 'salesChannel', values: [CHANNEL] },
    ],
  },
  orTwoCategories: {
    kind: 'group',
    op: 'OR',
    children: [
      { kind: 'criterion', type: 'category', values: [CAT_A] },
      { kind: 'criterion', type: 'category', values: [CAT_B] },
    ],
  },
};

const CATEGORY_WORLDS: Array<ReadonlySet<string>> = [
  new Set<string>(),
  new Set([CAT_A]),
  new Set([CAT_B]),
  new Set([CAT_A, CAT_B]),
];

describe('price-list candidate vector', () => {
  it('reproduces the priority walk for every product, over generated rule sets', () => {
    const names = Object.keys(RULES);
    let checked = 0;
    // Every three-rule combination, each rule placed in either partition.
    for (let a = 0; a < names.length; a += 1) {
      for (let b = a + 1; b < names.length; b += 1) {
        for (let c = b + 1; c < names.length; c += 1) {
          const lists = [
            list('list-a', RULES[names[a]!]!, { modifiedAt: new Date('2026-03-01') }),
            list('list-b', RULES[names[b]!]!, { modifiedAt: new Date('2026-02-01') }),
            list('list-c', RULES[names[c]!]!, {
              modifiedAt: new Date('2026-01-01'),
              type: 'sale',
            }),
          ];
          for (const world of CATEGORY_WORLDS) {
            for (const partition of ['base', 'sale'] as const) {
              expect(
                vectorForProduct(lists, world, partition),
                `${names[a]}/${names[b]}/${names[c]} categories=${[...world].join(',')} ${partition}`,
              ).toEqual(walkForProduct(lists, world, partition));
              checked += 1;
            }
          }
        }
      }
    }
    // The loop is the assertion; this only proves it ran over a real corpus.
    expect(checked).toBeGreaterThan(1000);
  });

  it('orders every sale candidate above every base candidate', () => {
    // `lineFromEngine` charges the sale price whenever the sale partition
    // resolves anything at all, so the two partitions are not interleaved by
    // priority — a low-priority sale list still beats the buyer's own base list.
    const vector = buildCandidateVector(
      [
        list('org-base', RULES['org']!),
        list('all-sale', RULES['all']!, { type: 'sale' }),
      ],
      viewer,
    );
    expect(vector.map((c) => c.priceListId)).toEqual(['all-sale', 'org-base']);
  });

  it('emits one unrestricted candidate when no rule names a category', () => {
    const vector = buildCandidateVector([list('l', RULES['channel']!)], viewer);
    expect(vector).toEqual([{ priceListId: 'l', isSale: false, requireAnyOf: [] }]);
  });

  it('turns a category criterion into a membership predicate, not an evaluation', () => {
    const vector = buildCandidateVector([list('l', RULES['orCatChannel']!)], viewer);
    // Two entries: the `category` level for products in CAT_B, and the
    // `salesChannel` level for everything else on the channel. Same list, two
    // ranks, because its own rule ranks it differently per product.
    expect(vector).toHaveLength(2);
    expect(vector[0]).toEqual({ priceListId: 'l', isSale: false, requireAnyOf: [[CAT_B]] });
    expect(vector[1]).toEqual({ priceListId: 'l', isSale: false, requireAnyOf: [] });
  });

  it('drops a candidate whose rule cannot match this viewer at all', () => {
    expect(buildCandidateVector([list('l', RULES['otherOrg']!)], viewer)).toEqual([]);
  });

  it('refuses a rule with more category criteria than it enumerates', () => {
    const children: ApplicationRule[] = [];
    for (let i = 0; i <= MAX_CATEGORY_CRITERIA_PER_RULE; i += 1) {
      children.push({ kind: 'criterion', type: 'category', values: [`cat-${i}`] });
    }
    expect(() =>
      buildCandidateVector([list('l', { kind: 'group', op: 'OR', children })], viewer),
    ).toThrow(UnorderableRuleError);
  });
});
