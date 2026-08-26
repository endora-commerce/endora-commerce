/**
 * Fulfilment-strategy resolver — pure function (feature 010 / FR-029…FR-033,
 * research §R4).
 *
 * The implementation moved to `@endora-commerce/contracts` in feature 075's Phase P
 * (FR-013), with its twin in `effective-fulfilment-strategy.ts` and for the
 * same reason: candidate warehouses in, an allocation decision out, and no
 * table read anywhere in it.
 *
 * Re-exported here for the length of Phase P, which cuts no consumer.
 */
export {
  type CandidateWarehouse,
  type AllocationDecision,
  type ResolveAllocationsInput,
  type AllocationOutcome,
  resolveAllocations,
} from '@endora-commerce/contracts';
