// FoldersService — Phase 2 skeleton. US2 fills the real bodies (create,
// rename, move with cycle detection, delete with `ifNonEmpty` strategies).

import type { EntityManager } from '@mikro-orm/postgresql';

export class FoldersService {
  constructor(private readonly _emFactory: () => EntityManager) {
    // suppress unused-private-field lint
    void this._emFactory;
  }
}
