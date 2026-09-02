/**
 * Pure rule evaluator (feature 011 / FR-022, FR-023, FR-026, FR-029).
 *
 * The implementation moved to `@endora-commerce/contracts` in feature 075's Phase P
 * (FR-013): it is a pure function over an `ApplicationRule` — a shape that
 * package already declares — and a context of plain ids, so switching
 * `price_lists` off cannot change whether a rule matches and a gated port
 * answering 503 would be a bug rather than a degrade.
 *
 * There is a second reason it had to be one implementation rather than a port:
 * `organizations` evaluates the same rules to work out an organisation's
 * effective price lists, and it must reach the *same* answer the resolver
 * does. Two copies that drifted would show an operator one set of lists on the
 * organisation screen and price from another at checkout.
 *
 * The two type names widen when they leave the module (`ResolutionContext` and
 * `RuleEvaluation` are too generic for a package every module imports), so
 * they are aliased back here. Both this shim and the aliases go with the last
 * consumer Phase C rewires.
 */
import type {
  PriceListResolutionContext,
  PriceListRuleEvaluation,
} from '@endora-commerce/contracts';

export { evaluateApplicationRule } from '@endora-commerce/contracts';

export type ResolutionContext = PriceListResolutionContext;
export type RuleEvaluation = PriceListRuleEvaluation;
