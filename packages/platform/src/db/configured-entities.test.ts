import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { describe, expect, it } from 'vitest';

import { UnclassifiedEntityError } from '../tenancy/entity-classification.js';
import { GlobalEntity } from '../tenancy/org-scoped.decorator.js';
import { configuredEntitiesFrom } from './configured-entities.js';

/**
 * `configuredEntitiesFrom` is where the classification refusal runs
 * (`specs/190-overlay-full-modules/` T061, contract
 * `entity-classification-refusal.md` §1): after the merged list is built and
 * before the ORM exists, in every process that configures one.
 *
 * No instance root is declared, so the package scan reads this checkout, where
 * every `@endora-commerce/*` entry is a workspace link and is refused as one
 * (`installed-packages.ts`): the list under test is the platform's own entities
 * plus what each case hands in as the core registry. The package origin is
 * covered by `entity-classification.test.ts`.
 */
const noPackages: NodeJS.ProcessEnv = {};

describe('configuredEntitiesFrom', () => {
  it('returns the merged list when every entity is classified', async () => {
    @Entity({ tableName: 'fx_configured_ok' })
    @GlobalEntity()
    class ConfiguredOk {
      @PrimaryKey() id!: string;
    }

    const entities = await configuredEntitiesFrom({ coreEntities: [ConfiguredOk], env: noPackages });
    expect(entities).toContain(ConfiguredOk);
  });

  it('refuses before returning when a core entity carries no classification', async () => {
    @Entity({ tableName: 'fx_configured_unclassified' })
    class ConfiguredUnclassified {
      @PrimaryKey() id!: string;
    }

    const refused = await configuredEntitiesFrom({
      coreEntities: [ConfiguredUnclassified],
      env: noPackages,
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(UnclassifiedEntityError);
    expect((refused as UnclassifiedEntityError).findings).toEqual([
      { className: 'ConfiguredUnclassified', contributor: 'core', kind: 'unclassified' },
    ]);
  });
});
