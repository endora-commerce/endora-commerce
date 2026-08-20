import { describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.generated.js';
import {
  declaredEntityNamesFor,
  registeredEntityNamesFor,
} from '../../helpers/entity-registry.js';

/**
 * `blog`'s entities reach the ORM (feature 072 FR-030, issue #73).
 *
 * This used to compare `blog/backend.ts`'s exported `entities` array with what
 * the ORM loads. That array was a second answer to "which entities does this
 * module own": nothing read it — `ModuleEntry` has no such member and MikroORM
 * reads `src/db/entities-registry.generated.ts` — so the next entity added to
 * `blog` could have been declared in the wrong one of the two. It is deleted,
 * and the assertion it was worth keeping is kept here, pointed at the generated
 * registry.
 *
 * `blog` is the subject because it owns eleven entities across three shapes —
 * aggregates, per-language rows and join tables — so a walk that found only the
 * obvious ones would show up.
 */

describe('blog — the entities the ORM loads', () => {
  const declared = declaredEntityNamesFor('blog');
  const registered = registeredEntityNamesFor('blog');

  it('declares entities at all, so the comparison below is not vacuous', () => {
    expect(declared.length).toBeGreaterThan(10);
  });

  it('registers every entity the module declares, and nothing else', () => {
    expect(registered).toEqual(declared);
  });

  it('exports each of them from the array the ORM config reads', () => {
    const exported = new Set(ALL_ENTITIES.map((entity) => (entity as { name: string }).name));
    for (const name of registered) expect(exported, name).toContain(name);
  });
});
