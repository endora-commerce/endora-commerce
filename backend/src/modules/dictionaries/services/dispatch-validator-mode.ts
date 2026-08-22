/**
 * `dispatchValidatorMode` moved to `@endora-commerce/contracts` in feature 075's Phase P.
 *
 * It is published as a **function, not a port**, which contradicts
 * `contracts/port-publication.md` §1.5 — that section names this file as the
 * worked example of a helper that "reads state the module owns", and it reads
 * nothing. Three comparisons over its two arguments: switching `dictionaries`
 * off cannot change the answer, so a gated port would answer 503 to a question
 * about two strings the caller already holds (FR-013).
 *
 * The five callers reach `dictionaryValidator` immediately afterwards, and
 * that one *is* a port and *does* read this module's tables. Splitting the
 * pure decision from the stateful validation is what lets the second fail
 * closed without the first inventing a mode.
 *
 * Re-exported here for the length of Phase P, which cuts no consumer.
 */
export { dispatchValidatorMode } from '@endora-commerce/contracts';
