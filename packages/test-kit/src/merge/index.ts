/**
 * `@endora-commerce/test-kit/merge` — the merge-participant conformance helper
 * (`specs/192-organization-merge/` `contracts/merge-participant.md` §3), and
 * the in-memory world a module package's co-located conformance test runs its
 * participant's own Command in.
 */
export { expectMergeParticipant, type ExpectMergeParticipantOptions } from './expect-merge-participant.js';
export { createMemoryMergeWorld, type MemoryAuditEntry, type MemoryMergeWorld } from './memory-merge-world.js';
