import { describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.generated.js';
import { entities as blogEntities } from '../../../src/modules/blog/backend.js';

/**
 * `backend.ts` exports the module's entity list (feature 072, T040 / FR-030).
 *
 * The list is only worth exporting if it is the truth, so this pins it to what
 * the ORM actually loads. It is the assertion that makes User Story 4 —
 * "removing a module leaves nothing behind" — checkable: an entity added to
 * `blog` and forgotten in one of the two places is a failure here rather than a
 * missing table at runtime or an orphan the removal check cannot see.
 *
 * `ALL_ENTITIES` is generated from the tree since feature 071's F2, so the
 * "forgotten in one of the two places" half is now structurally impossible on
 * the registry side. What is left is the half that still matters: the module's
 * own exported list is hand-written and can drift from what it actually
 * declares.
 */

describe('blog — the exported entity list', () => {
  const ownedByBlog = ALL_ENTITIES.filter((entity) =>
    /^Blog[A-Z]/.test((entity as { name: string }).name),
  );

  it('names every blog entity the ORM loads', () => {
    expect([...blogEntities].map((e) => e.name).sort()).toEqual(
      ownedByBlog.map((e) => (e as { name: string }).name).sort(),
    );
  });

  it('names nothing the ORM does not load', () => {
    for (const entity of blogEntities) {
      expect(ALL_ENTITIES, entity.name).toContain(entity);
    }
  });
});
