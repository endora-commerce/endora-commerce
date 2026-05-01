// @b2b/contracts — Compare module contracts (feature 007).
//
// Per Constitution V, this file is the source of truth for every Zod schema
// crossing the comparisons HTTP boundary; TS types are inferred via z.infer.
//
// Per-user-story schemas land in subsequent tasks:
//   - US1 (owner CRUD)               → T016
//   - US2 (share-token recipient view) → T036
//   - US4 (PDF export)               → T050
//   - US5 (admin overview)           → T059
//
// This file currently exports nothing; it exists as a compilable scaffold
// so packages/contracts/src/index.ts can re-export from it (T003) before
// the per-story schemas are authored.
export {};
