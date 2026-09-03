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

export {
  countBlockNames,
  mapBlockNames,
  renameBlockNames,
  type BlockNameVisitor,
  type BlockNameWalkResult,
} from './walk-block-names.js';
