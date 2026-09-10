import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CmsBlock } from '../entities/cms-block.entity.js';
import { CmsBlockReadService } from './cms-block-read-port.js';

/**
 * `specs/110-instance-repository/` T118c — the block read model this module
 * publishes, drained out of two composition-root closures.
 *
 * **It composes nothing, deliberately**, for the reason
 * `asset-embed-resolver.test.ts` records: a module package's test naming
 * `@endora-commerce/platform/composition` is a host-internal reach
 * `check:platform-surface` cannot refuse in a `.test.ts`, and that silence is a
 * registered blind spot rather than a permission. The service is a function of
 * an `EntityManager` factory, so a stub over one `findOne` is the whole harness.
 *
 * **What this file cannot see** is that `backend/index.ts` provides the port at
 * all, or that `megamenu` resolves it. That is
 * `backend/test/integration/megamenu/cross-module-targets.test.ts`, over the
 * composed harness, and it is the one to keep.
 */

function block(overrides: Partial<CmsBlock> = {}): CmsBlock {
  const b = new CmsBlock();
  b.id = '11111111-1111-4111-8111-111111111111';
  b.code = 'hero';
  b.name = 'Hero';
  b.active = true;
  b.content = { languages: { 'en-US': { content: [{ type: 'cms.Heading' }] } } };
  b.languages = ['en-US'];
  return Object.assign(b, overrides);
}

/** An `EntityManager` that answers one `findOne` and records what it was asked. */
function emStub(answer: CmsBlock | null): {
  factory: () => EntityManager;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) => {
      calls.push(where);
      return answer;
    },
  } as unknown as EntityManager;
  return { factory: () => em, calls };
}

describe('CmsBlockReadService (T118c)', () => {
  describe('findById', () => {
    it('maps the three published fields and nothing else', async () => {
      const { factory } = emStub(block({ description: 'internal note' }));
      const record = await new CmsBlockReadService(factory).findById('any');

      // Exactly the record's keys: `content`, `languages`, `version` and the
      // timestamps do not cross, which is the whole reason the storefront read
      // below is a second method rather than a wider first one.
      expect(record).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        code: 'hero',
        active: true,
      });
    });

    it('answers a deactivated block rather than hiding it', async () => {
      // The validator's question is existence, and an operator editing a
      // deactivated block must still be able to point a menu item at it. The
      // flag rides on the record so the *caller* decides — the two roots' SQL
      // did not filter it either, so this is the behaviour being preserved.
      const { factory } = emStub(block({ active: false }));
      expect(await new CmsBlockReadService(factory).findById('any')).toMatchObject({
        active: false,
      });
    });

    it('answers null for an id nothing holds', async () => {
      const { factory } = emStub(null);
      expect(await new CmsBlockReadService(factory).findById('gone')).toBeNull();
    });
  });

  describe('findLocalizedById', () => {
    it('returns the tree for the language asked for', async () => {
      const { factory, calls } = emStub(block());
      const record = await new CmsBlockReadService(factory).findLocalizedById(
        '11111111-1111-4111-8111-111111111111',
        'en-US',
      );

      expect(record).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        code: 'hero',
        language: 'en-US',
        data: { content: [{ type: 'cms.Heading' }] },
      });
      // The `active` narrowing is the query's, not a post-filter: a storefront
      // read of a deactivated block must not load its content at all.
      expect(calls[0]).toMatchObject({ active: true });
    });

    it('answers null when the block carries nothing for that language', async () => {
      // Not a fallback and not an empty tree. `cms`' own hook resolution falls
      // back to `{}` for its own surfaces; this port answers the caller that
      // drops the item, which is what both composition roots did.
      const { factory } = emStub(block());
      expect(
        await new CmsBlockReadService(factory).findLocalizedById('any', 'pl-PL'),
      ).toBeNull();
    });

    it('answers null when the language key is present but explicitly undefined', async () => {
      const { factory } = emStub(block({ content: { languages: { 'pl-PL': undefined } } }));
      expect(
        await new CmsBlockReadService(factory).findLocalizedById('any', 'pl-PL'),
      ).toBeNull();
    });

    it('answers null for a block with no envelope at all', async () => {
      // A legacy row, or one seeded before the envelope existed. The optional
      // chain is what stops it throwing on a storefront request.
      const { factory } = emStub(block({ content: {} }));
      expect(
        await new CmsBlockReadService(factory).findLocalizedById('any', 'en-US'),
      ).toBeNull();
    });

    it('answers null for an id nothing holds', async () => {
      const { factory } = emStub(null);
      expect(await new CmsBlockReadService(factory).findLocalizedById('gone', 'en-US')).toBeNull();
    });
  });
});
