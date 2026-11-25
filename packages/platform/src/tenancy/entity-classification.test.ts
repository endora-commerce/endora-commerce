import { Embeddable, Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { describe, expect, it } from 'vitest';

import {
  assertEntitiesClassified,
  UnclassifiedEntityError,
  type ContributedEntity,
} from './entity-classification.js';
import { GlobalEntity, OrgScoped, tenantClassifications } from './org-scoped.decorator.js';

/**
 * `specs/190-overlay-full-modules/` Phase 5 (#1849, FR-020 – FR-021) — no process
 * boots with an entity that carries no tenancy classification, or more than one.
 *
 * Every fixture is a real decorated class: the predicate reads what MikroORM's
 * decorator and the classification decorator recorded, never a literal this file
 * built by hand (`transitive-parent-resolution.test.ts`'s rule). Classes declared
 * here register in the module-level classification registry, which is why each
 * call names the entity list it judges: the refusal is over the configured list,
 * not over everything that was ever decorated.
 */

function refusal(entities: readonly ContributedEntity[]): UnclassifiedEntityError {
  try {
    assertEntitiesClassified(entities);
  } catch (error) {
    if (error instanceof UnclassifiedEntityError) return error;
    throw error;
  }
  throw new Error('assertEntitiesClassified accepted the list');
}

describe('assertEntitiesClassified', () => {
  it('accepts classified entities of every origin', () => {
    @Entity({ tableName: 'fx_classified_core' })
    @OrgScoped()
    class ClassifiedCore {
      @PrimaryKey() id!: string;
      organizationId!: string;
    }
    @Entity({ tableName: 'fx_classified_package' })
    @GlobalEntity()
    class ClassifiedPackage {
      @PrimaryKey() id!: string;
    }

    expect(() =>
      assertEntitiesClassified([
        { cls: ClassifiedCore, contributor: 'core' },
        { cls: ClassifiedPackage, contributor: '@acme/mod-xl' },
      ]),
    ).not.toThrow();
  });

  it('refuses an unclassified entity of each origin, naming the class and its contributor', () => {
    @Entity({ tableName: 'fx_unclassified_core' })
    class UnclassifiedCore {
      @PrimaryKey() id!: string;
    }
    @Entity({ tableName: 'fx_unclassified_package' })
    class XlCursor {
      @PrimaryKey() id!: string;
    }
    @Entity({ tableName: 'fx_unclassified_overlay' })
    class LoyaltyAccount {
      @PrimaryKey() id!: string;
    }

    const error = refusal([
      { cls: UnclassifiedCore, contributor: 'core' },
      { cls: XlCursor, contributor: '@acme/mod-xl' },
      { cls: LoyaltyAccount, contributor: 'overlay apps/acme/modules/acme_loyalty' },
    ]);
    expect(error.findings).toEqual([
      { className: 'UnclassifiedCore', contributor: 'core', kind: 'unclassified' },
      { className: 'XlCursor', contributor: '@acme/mod-xl', kind: 'unclassified' },
      {
        className: 'LoyaltyAccount',
        contributor: 'overlay apps/acme/modules/acme_loyalty',
        kind: 'unclassified',
      },
    ]);
    expect(error.message).toContain('[tenancy] 3 entity classes carry no tenancy classification');
    expect(error.message).toContain('  - XlCursor (@acme/mod-xl)');
    expect(error.message).toContain('Nothing was opened.');
  });

  it('refuses an entity classified twice', () => {
    @Entity({ tableName: 'fx_doubly' })
    @GlobalEntity()
    @OrgScoped()
    class DoublyClassified {
      @PrimaryKey() id!: string;
      organizationId!: string;
    }

    const error = refusal([{ cls: DoublyClassified, contributor: 'core' }]);
    expect(error.findings).toEqual([
      { className: 'DoublyClassified', contributor: 'core', kind: 'multiply-classified' },
    ]);
    expect(error.message).toContain('DoublyClassified (core) — classified 2 times');
  });

  it('judges embeddables and abstract bases as MikroORM records them: not entities', () => {
    @Embeddable()
    class Money {
      amount!: string;
    }
    @Entity({ abstract: true })
    abstract class Timestamped {
      createdAt!: Date;
    }

    expect(() =>
      assertEntitiesClassified([
        { cls: Money, contributor: 'core' },
        { cls: Timestamped, contributor: 'core' },
      ]),
    ).not.toThrow();
  });

  it('tells two classes of one name apart by identity, not by name', () => {
    const classified = (() => {
      @Entity({ tableName: 'fx_same_name_a' })
      @GlobalEntity()
      class SameName {
        @PrimaryKey() id!: string;
      }
      return SameName;
    })();
    const unclassified = (() => {
      @Entity({ tableName: 'fx_same_name_b' })
      class SameName {
        @PrimaryKey() id!: string;
      }
      return SameName;
    })();
    expect(tenantClassifications().some((meta) => meta.className === 'SameName')).toBe(true);

    const error = refusal([
      { cls: classified, contributor: 'core' },
      { cls: unclassified, contributor: '@acme/mod-twin' },
    ]);
    expect(error.findings).toEqual([
      { className: 'SameName', contributor: '@acme/mod-twin', kind: 'unclassified' },
    ]);
  });
});
