/**
 * Re-export shim — this file's sources now live in `@endora-commerce/platform`
 * (feature 080, the platform relocation; D-160, D-164, D-165).
 *
 * The five platform directories moved to `packages/platform/src/` so that the
 * application and an installed extension package resolve **one** copy of the
 * platform. Everything in `backend/` still names them at their old paths, and
 * each of those specifiers now arrives here and is forwarded to the package.
 * The forwarding target is the package's build output, which is what its
 * `exports` map serves, so a bare specifier and a relative one land on the same
 * file and therefore on the same module record.
 *
 * This one is **younger than the relocation** and arrived with
 * `specs/117-instance-bring-up/` FR-030: the routing derivation was `_i18n`'s
 * until then, so it was reached by a bare specifier into that module's package
 * and needed no shim. It has a shim now for the reason its sibling
 * `request-language.ts` does — the target is host-only surface that no barrel
 * carries, so the reach needs a declared subpath before it has an address to
 * name.
 *
 * These shims are the bridge, not the destination: each is deleted as the
 * consumer that reaches through it moves into the platform and rewrites its
 * specifier (`specs/110-instance-repository/` Phase 2).
 */
export * from '../../../../packages/platform/dist/kernel/i18n/error-translation.js';
