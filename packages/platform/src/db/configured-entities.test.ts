import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { afterAll, describe, expect, it } from 'vitest';

import { defineColumnExtension } from '../kernel/schema-extensions/define.js';
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

/**
 * The overlay half (`specs/190-overlay-full-modules/` FR-033, FR-035, contract
 * `overlay-schema-discovery.md` §2, #1850): the active deployment's overlay
 * entities join the set, and are held to the same classification refusal with
 * the overlay named as their contributor.
 *
 * The fixture's `backend.js` takes its classes off `globalThis` rather than
 * declaring them: a temporary directory resolves no package, and the classes
 * must be decorated by the decorators this process's registries hold.
 */
describe('configuredEntitiesFrom — an overlay module\'s entities', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const slot = '__configuredEntitiesOverlayFixture';
  const deploymentRoot = (entities: readonly unknown[]): string => {
    (globalThis as Record<string, unknown>)[slot] = entities;
    const root = mkdtempSync(join(tmpdir(), 'configured-entities-'));
    roots.push(root);
    const moduleDir = join(root, 'apps', 'shop', 'modules', 'notice');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(
      join(moduleDir, 'manifest.js'),
      "export const manifest = { id: 'notice', version: '1.0.0', dependencies: [] };\n",
    );
    writeFileSync(
      join(moduleDir, 'backend.js'),
      `export const entities = globalThis[${JSON.stringify(slot)}];\nexport function registerModule() {}\n`,
    );
    return root;
  };

  it('adds them to the set when the deployment is selected, and only then', async () => {
    @Entity({ tableName: 'fx_configured_overlay_ok' })
    @GlobalEntity()
    class OverlayNotice {
      @PrimaryKey() id!: string;
    }
    const root = deploymentRoot([OverlayNotice]);

    const selected = await configuredEntitiesFrom({
      coreEntities: [],
      env: { DEPLOYMENT: 'shop' },
      deploymentRoot: root,
    });
    expect(selected).toContain(OverlayNotice);

    const bare = await configuredEntitiesFrom({ coreEntities: [], env: {}, deploymentRoot: root });
    const none = await configuredEntitiesFrom({ coreEntities: [], env: {} });
    expect(bare).not.toContain(OverlayNotice);
    expect(bare).toEqual(none);
  });

  it('refuses an unclassified overlay entity, naming the overlay as its contributor (FR-020)', async () => {
    @Entity({ tableName: 'fx_configured_overlay_unclassified' })
    class OverlayUnclassified {
      @PrimaryKey() id!: string;
    }
    const refused = await configuredEntitiesFrom({
      coreEntities: [],
      env: { DEPLOYMENT: 'shop' },
      deploymentRoot: deploymentRoot([OverlayUnclassified]),
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(UnclassifiedEntityError);
    expect((refused as UnclassifiedEntityError).findings).toEqual([
      {
        className: 'OverlayUnclassified',
        contributor: 'overlay apps/shop/modules/notice',
        kind: 'unclassified',
      },
    ]);
  });

  it('leaves the overlay’s schemaExtensions to the migration merge, which knows the composed graph (FR-065)', async () => {
    // `organizations` is reached only through `customers`, a module outside the
    // overlay root: V10 holds only over the composed graph, which the entity set
    // is not built from. The merge judges the declaration; this reader must not
    // refuse what that one accepts.
    const slotted = '__configuredEntitiesOverlayDeclaration';
    (globalThis as Record<string, unknown>)[slotted] = [
      defineColumnExtension({
        host: 'organizations',
        module: 'notice',
        columns: { erpCode: { type: 'text', nullable: true } },
      }),
    ];
    const root = mkdtempSync(join(tmpdir(), 'configured-entities-'));
    roots.push(root);
    const moduleDir = join(root, 'apps', 'shop', 'modules', 'notice');
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(
      join(moduleDir, 'manifest.js'),
      "export const manifest = { id: 'notice', version: '1.0.0', dependencies: ['customers'] };\n",
    );
    writeFileSync(
      join(moduleDir, 'backend.js'),
      `export const schemaExtensions = globalThis[${JSON.stringify(slotted)}];\n` +
        'export function registerModule() {}\n',
    );
    await expect(
      configuredEntitiesFrom({ coreEntities: [], env: { DEPLOYMENT: 'shop' }, deploymentRoot: root }),
    ).resolves.toBeDefined();
  });
});
