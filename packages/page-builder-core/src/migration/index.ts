// `@endora-commerce/page-builder-core/migration` — feature 096, T402/T403.
//
// **This subpath is not a runtime path.** It is imported by the five rename
// migrations and by `cms`' `block-names` report command, and by nothing else;
// `backend/test/unit/cms/frozen-map-not-on-a-runtime-path.test.ts` is what holds
// that true. The owner rejected a permanent alias map on 2026-09-02, and the
// difference between a frozen historical constant and an alias map is exactly
// whether a resolver can reach it.
//
// It is a subpath of its own — rather than the barrel, which the whole admin
// imports — so that the assertion has something to name.

export {
  FROZEN_BLOCK_RENAMES,
  FROZEN_BLOCK_RENAMES_INVERSE,
} from './frozen-block-renames.js';

export {
  applyRenameFunctionSql,
  createRenameFunctionSql,
  dropRenameFunctionSql,
} from './rename-block-names-sql.js';

// The structural walk itself is **not** part of this subpath's quarantine and
// lives one directory up, on the package's ordinary barrel (`../block-tree.js`).
// The thing that must not be reachable at runtime is the frozen rename *map*;
// the walk is a generic "offer me every node `type` in this document", and the
// admin's degradation merge needs exactly that to decide which stored names
// have no renderer (FR-019). Re-exported here so the five migrations and the
// report keep importing one specifier.
export {
  countBlockNames,
  mapBlockNames,
  renameBlockNames,
  type BlockNameVisitor,
  type BlockNameWalkResult,
} from '../block-tree.js';
