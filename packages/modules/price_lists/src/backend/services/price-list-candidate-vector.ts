import {
  evaluateApplicationRule,
  type ApplicationRule,
  type PriceListResolutionContext,
} from '@endora-commerce/contracts';
import { pickPriorityChain, type PriceListCandidate } from './price-list-resolver.js';

/**
 * The viewer's ordered price-list candidates (feature 086, research §R1), as a
 * **pure** function of the active lists and the viewer's rule dimensions.
 *
 * ## The structural fact this rests on
 *
 * `evaluateApplicationRule` has five criterion types — `salesChannel`,
 * `organization`, `customerGroup`, `currency`, `category` — and four of them
 * read only the viewer. **`category` is the only one that reads the product.**
 * So for a fixed viewer the set of lists that match, and the priority each
 * matches at, is the same for every product *except* where a rule names a
 * category; and `pickPriorityChain`'s walk is a total order over candidates, so
 * FR-031's fall-through ("drop the list with no usable bracket and re-pick") is
 * exactly "take the first candidate in that order that has a bracket" —
 * removing elements from a totally ordered set does not reorder what remains.
 *
 * That is what turns the resolution into a merge of ordered streams instead of
 * a per-product loop, and it is why this file exists at all.
 *
 * ## The order is produced by the walk, not by a copy of it
 *
 * The vector is built by calling {@link pickPriorityChain} repeatedly and
 * removing the winner — which *is* the fall-through walk, run to exhaustion.
 * Writing the priority chain out as a sort key would be a second implementation
 * of the resolver's ranking, free to drift from it; this cannot drift, because
 * it is the same function.
 *
 * ## The sale partition leads the base partition, wholesale
 *
 * `lineFromEngine` charges the sale price whenever the sale partition resolves
 * *any* bracket, and only otherwise the base one. So "first candidate that
 * prices the product wins" reproduces it exactly when every sale candidate is
 * ordered above every base candidate — not by interleaving the two partitions
 * by priority.
 *
 * ## Category criteria become membership predicates, not evaluations
 *
 * A rule that names a category matches some products and not others, so one
 * price list can appear in the vector **more than once**: once per subset of
 * its category criteria that could be true, each entry carrying the memberships
 * that subset requires. Two properties make that safe and make the entries
 * cheap:
 *
 *  - the rule AST is **monotone** (`all`, `criterion`, `AND`, `OR` — there is no
 *    negation), so making one more criterion true can only move `explicitOn`
 *    up the priority chain, never down. An entry therefore never over-ranks the
 *    products it covers: its rank is a floor, and the entry that carries the
 *    exact rank is enumerated too and sorts ahead of it;
 *  - which means an entry needs no *negative* membership predicate. It says
 *    which categories a product must be in, never which it must be out of, and
 *    a product that also satisfies a criterion the entry left out is answered by
 *    the better-ranked entry that includes it. Both entries name the same price
 *    list and therefore the same amount, so a tie between them changes nothing.
 *
 * The synthetic category set each subset is evaluated against still has to
 * exclude the criteria outside the subset, or the evaluation would come back
 * with a rank the subset has not earned. A subset whose criteria cannot all be
 * true once the others are excluded is unreachable and is skipped — the entry
 * that covers those products is the larger subset.
 */

/** A price list, as the vector reads it. */
export interface CandidateListInput {
  id: string;
  type: 'base' | 'sale';
  applicationRule: ApplicationRule;
  modifiedAt: Date;
  name: string;
  isSystem: boolean;
}

/** The viewer's rule dimensions — everything except the product. */
export interface CandidateViewerContext {
  organizationId: string | null;
  organizationChain: readonly string[];
  customerGroupId: string | null;
  salesChannelId: string;
  currencyCode: string;
}

/**
 * One stream of the merge: a price list, and the category memberships a product
 * must satisfy for this list to apply to it at this rank.
 */
export interface OrderedCandidate {
  priceListId: string;
  /** The partition the candidate came from — the row's `isSale`. */
  isSale: boolean;
  /**
   * Each group is one `category` criterion's value list. A product qualifies
   * when it belongs to **at least one** category in **every** group. An empty
   * array means the candidate applies to every product this viewer sees.
   */
  requireAnyOf: readonly (readonly string[])[];
}

/**
 * The most `category` criteria one rule may carry before this module refuses to
 * express the ordering.
 *
 * The enumeration is `2^k` per rule, so it needs a ceiling; 8 is far above
 * anything an operator writes (the reference catalogue's rules carry zero) and
 * still bounded at 256 evaluations of a pure function. Above it the answer is a
 * refusal rather than an approximation: an ordering that quietly ranked a list
 * wrongly is precisely the failure this feature exists to avoid, and an
 * unorderable page is visible while a mis-ordered one is not.
 */
export const MAX_CATEGORY_CRITERIA_PER_RULE = 8;

/** Thrown when a rule carries more `category` criteria than the vector enumerates. */
export class UnorderableRuleError extends Error {
  constructor(readonly priceListId: string) {
    super(
      `Price list ${priceListId} carries more than ${MAX_CATEGORY_CRITERIA_PER_RULE} category ` +
        'criteria, so its applicability cannot be expressed as an ordered stream.',
    );
    this.name = 'UnorderableRuleError';
  }
}

/**
 * The viewer's candidates, best first: every sale candidate in priority order,
 * then every base candidate in priority order.
 */
export function buildCandidateVector(
  lists: readonly CandidateListInput[],
  viewer: CandidateViewerContext,
): OrderedCandidate[] {
  const sale: Array<PriceListCandidate<OrderedCandidate>> = [];
  const base: Array<PriceListCandidate<OrderedCandidate>> = [];
  for (const list of lists) {
    for (const entry of entriesFor(list, viewer)) {
      (list.type === 'sale' ? sale : base).push(entry);
    }
  }
  return [...walk(sale), ...walk(base)];
}

/** `pickPriorityChain` run to exhaustion — the fall-through walk itself. */
function walk(candidates: Array<PriceListCandidate<OrderedCandidate>>): OrderedCandidate[] {
  const remaining = [...candidates];
  const out: OrderedCandidate[] = [];
  while (remaining.length > 0) {
    const picked = pickPriorityChain(remaining);
    if (!picked) break;
    out.push(picked.list);
    remaining.splice(remaining.indexOf(picked), 1);
  }
  return out;
}

function entriesFor(
  list: CandidateListInput,
  viewer: CandidateViewerContext,
): Array<PriceListCandidate<OrderedCandidate>> {
  const groups = categoryCriterionGroups(list.applicationRule);
  if (groups.length > MAX_CATEGORY_CRITERIA_PER_RULE) throw new UnorderableRuleError(list.id);

  const out: Array<PriceListCandidate<OrderedCandidate>> = [];
  const seen = new Set<string>();
  for (let mask = 0; mask < 1 << groups.length; mask += 1) {
    const included: string[][] = [];
    const excluded = new Set<string>();
    for (let i = 0; i < groups.length; i += 1) {
      if ((mask >> i) & 1) included.push(groups[i]!);
      else for (const value of groups[i]!) excluded.add(value);
    }
    // The categories a product covered by this subset may be assumed to carry:
    // everything the included criteria name, minus everything the excluded ones
    // do, so the evaluation below awards this subset's rank and no better one.
    const synthetic = new Set<string>();
    for (const group of included) {
      for (const value of group) if (!excluded.has(value)) synthetic.add(value);
    }
    // A criterion left with no representative cannot be true while the excluded
    // ones are false: the subset describes no product, and the products it was
    // meant to cover belong to a larger subset that is enumerated too.
    if (included.some((group) => !group.some((value) => synthetic.has(value)))) continue;

    const ctx: PriceListResolutionContext = {
      organizationId: viewer.organizationId,
      organizationChain: viewer.organizationChain,
      customerGroupId: viewer.customerGroupId,
      salesChannelId: viewer.salesChannelId,
      currencyCode: viewer.currencyCode,
      productCategoryIds: synthetic,
    };
    const evaluation = evaluateApplicationRule(list.applicationRule, ctx);
    if (!evaluation.matched) continue;

    const requireAnyOf = included.map((group) => [...group].sort());
    const signature = `${[...evaluation.explicitOn].sort().join('+')}|${
      evaluation.organizationRank ?? ''
    }|${requireAnyOf.map((g) => g.join(',')).join(';')}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    out.push({
      list: { priceListId: list.id, isSale: list.type === 'sale', requireAnyOf },
      evaluation,
      modifiedAt: list.modifiedAt,
      name: list.name,
      isSystem: list.isSystem,
    });
  }
  return out;
}

/**
 * The distinct `category` criteria in a rule, as value groups.
 *
 * De-duplicated by value set: two criteria naming the same categories are the
 * same predicate, and collapsing them keeps the enumeration below its ceiling
 * in the shape an operator most plausibly writes one (the same category named
 * in both halves of an `OR`).
 */
function categoryCriterionGroups(rule: ApplicationRule): string[][] {
  const byKey = new Map<string, string[]>();
  const visit = (node: ApplicationRule): void => {
    if (node.kind === 'criterion') {
      if (node.type !== 'category' || node.values.length === 0) return;
      const values = [...new Set(node.values)].sort();
      byKey.set(values.join(','), values);
      return;
    }
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(rule);
  return [...byKey.values()];
}
