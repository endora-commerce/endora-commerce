import { describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.js';
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
 * `ALL_ENTITIES` stays hand-maintained until the generator of T049 replaces it.
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
