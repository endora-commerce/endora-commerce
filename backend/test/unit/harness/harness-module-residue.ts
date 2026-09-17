/**
 * What `backend/test/helpers/test-server.ts` still names of a module package,
 * and why each group is still right to be there **today**.
 *
 * A two-way draining ledger, in `check:module-boundary`'s shape and for its
 * reason: an entry that is no longer true fails the run as loudly as one that is
 * new. Nothing may be added without the group's reason being written beside it,
 * and the expected end state of every group is the empty array —
 * `specs/109-backend-test-kit/` T050, T051 and T064, scheduled as T013 and T014
 * of `specs/134-paid-module-extraction/`.
 *
 * **It is a ledger and not a threshold on purpose.** A count that may only fall
 * lets one coupling replace another, which is exactly how the two god-objects
 * grew from 3 option fields to 22 in three months.
 */

/**
 * Specifiers that resolve into a module package.
 *
 * Retired by 109 T050/T051: each one is here because a member of
 * `BackendServerOptions` or `BackendServerHandle` is typed by it, or because the
 * harness constructs that module's default test double. Both go with the fields.
 */
export const LEDGERED_MODULE_SPECIFIERS: readonly string[] = [];

/**
 * `Interface.member` pairs whose type names a module package.
 *
 * Retired by 109 T050 (the handle, 29 today) and T051 (the options, 12 today).
 * Feature 109 SC-003 is these two counts reaching zero.
 */
export const LEDGERED_MODULE_TYPE_REFERENCES: readonly string[] = [];

/**
 * Table names a module package owns, written into the harness's wipe list.
 *
 * Retired by 109 T060-T064: the set a composition truncates is contributed by
 * the modules in it, and its order is derived from the foreign-key graph rather
 * than hand-written. Feature 134 T014 takes the paid modules' share first.
 */
export const LEDGERED_MODULE_TABLE_NAMES: readonly string[] = [];
