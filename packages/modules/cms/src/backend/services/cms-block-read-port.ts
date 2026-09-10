import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CmsBlockReadPort,
  CmsBlockRecord,
  CmsLocalizedBlockRecord,
} from '@endora-commerce/contracts';
import { CmsBlock } from '../entities/cms-block.entity.js';

/**
 * The block read model `cms` publishes (`specs/110-instance-repository/` T118c).
 *
 * `megamenu` is the only consumer and it asks two questions: *does this block
 * exist* (the admin-side target validator, which refuses a menu item pointing at
 * a block that is not there) and *what does it render as in this language* (the
 * storefront resolver, which inlines the tree into the menu payload). Both were
 * a `select … from cms_blocks` written twice in composition roots — once in
 * `backend/src/composition.ts` and once in `backend/test/helpers/test-server.ts`
 * — so this module's table and this module's envelope layout were read by a file
 * this module does not own.
 *
 * **The envelope stops here.** `content.languages[<code>]` is a storage decision:
 * which key a language hangs off, that a legacy `schema_version` may ride along,
 * and that an absent key means "nothing authored" are all facts about the column,
 * and the localized record is what lets a consumer have the tree without them.
 * The root closure knew every one of them.
 */
export class CmsBlockReadService implements CmsBlockReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<CmsBlockRecord | null> {
    const block = await this.emFactory().findOne(CmsBlock, { id });
    return block ? { id: block.id, code: block.code, active: block.active } : null;
  }

  async findLocalizedById(
    id: string,
    language: string,
  ): Promise<CmsLocalizedBlockRecord | null> {
    /**
     * `active: true` in the predicate rather than after it, which is the
     * narrowing the storefront closure carried and the validator's did not: a
     * deactivated block is content an operator has withdrawn, and loading its
     * tree to throw it away is a read nobody asked for.
     */
    const block = await this.emFactory().findOne(CmsBlock, { id, active: true });
    if (!block) return null;

    const languages = (block.content as { languages?: Record<string, unknown> }).languages;
    const data = languages?.[language];
    // No fallback language, deliberately. This module's *own* hook resolution
    // falls back to `{}` so a page still renders; a consumer inlining a block
    // into somebody else's payload wants to know there is nothing to inline, and
    // both composition roots answered `null` here.
    if (data === undefined) return null;

    return { id: block.id, code: block.code, language, data };
  }
}
