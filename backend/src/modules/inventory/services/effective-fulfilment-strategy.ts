/**
 * Effective fulfilment-strategy resolver — pure function.
 *
 * The implementation moved to `@b2b/contracts` in feature 075's Phase P
 * (FR-013): it is pure over its arguments — three configuration layers in, one
 * resolved strategy out — so switching `inventory` off cannot change the
 * answer and a gated port answering 503 would be a bug rather than a degrade.
 *
 * `orders` calls it at placement, inside its own transaction, through a
 * dynamic import. Publishing it lets that cut remove the dynamic import rather
 * than wrap it.
 *
 * Re-exported here for the length of Phase P, which cuts no consumer.
 */
export {
  type FulfilmentLayer,
  type EffectiveFulfilment,
  resolveEffectiveFulfilmentStrategy,
} from '@b2b/contracts';
