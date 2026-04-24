// @b2b/contracts — source-of-truth Zod schemas for every API boundary of the B2B platform.
//
// Per Principle V of the constitution, this package is the ONLY place where request/response
// shapes are defined. The backend regenerates its live OpenAPI document from here at startup
// (see research.md R-05). TypeScript types consumed by the backend, storefront, and admin are
// inferred from these schemas via `z.infer`; they are not maintained by hand.
//
// Module-specific schemas are added by each user-story phase in tasks.md
// (catalog.ts, quote-requests.ts, organizations.ts, orders.ts, credit-limits.ts, …).

export * from './errors.js';
export * from './envelopes.js';
export * from './pagination.js';
export * from './common.js';
