/**
 * Pluggable VAT-ID validator port (feature 026 US7).
 *
 * The real production adapters reach out to VIES (EU VAT IDs) and the
 * Polish Ministerstwo Finansów whitelist (Polish NIPs). Tests inject
 * fake adapters so the suite never makes real HTTP calls.
 *
 * Every adapter MUST degrade safely: a transient network failure or a
 * provider-side 5xx returns `{ outcome: 'deferred', errorKind: ... }`
 * rather than throwing. A clean "not registered" response returns
 * `{ outcome: 'failed', errorKind: 'not_found' }`. Only `validated`
 * carries the optional `legalName` + `address` payloads that the
 * applyAutoFill flow consumes.
 *
 * The two declarations moved to `@endora-commerce/contracts` in feature 075's Phase P so
 * `customers` can name the shape without naming this directory. They are
 * re-exported here for the length of Phase P, which cuts no consumer.
 */
export type { VatValidationResult, VatValidator } from '@endora-commerce/contracts';
