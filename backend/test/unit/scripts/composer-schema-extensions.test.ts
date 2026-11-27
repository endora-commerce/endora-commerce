import { describe, expect, it } from 'vitest';

import {
  assertNoSchemaExtensionDeclarations,
  coreSources,
  mergeSources,
  packageSources,
} from '../../../scripts/generate-composer.js';
import type { ModulePackage } from '../../../scripts/lib/module-packages.js';

/**
 * `specs/178-extensible-columns/` FR-008, FR-064 (tasks.md T011).
 *
 * Declared extension columns are an **installed** package's mechanism, and an
 * overlay module's since D-297 (OR-3): a first-party workspace module owns its
 * tables or ships a side table. So the composer, which walks every workspace
 * source, refuses a declaration anywhere but under `apps/` — by the call and by
 * the export, read off the syntax tree so a comment quoting either does not
 * trip it.
 */

const workspaceModule: ModulePackage = {
  moduleId: 'acme_erp',
  name: '@endora-commerce/mod-acme-erp',
  dir: '/repo/packages/modules/acme_erp',
  exports: new Map([
    ['.', './dist/manifest.js'],
    ['./backend', './dist/backend/index.js'],
  ]),
  emit: null,
};

const DECLARATION = [
  "import { defineColumnExtension } from '@endora-commerce/platform/kernel';",
  'export const acmeOrganizationColumns = defineColumnExtension({',
  "  host: 'organizations', module: 'acme_erp',",
  "  columns: { erpCode: { type: 'text', nullable: true } },",
  '});',
].join('\n');

describe('assertNoSchemaExtensionDeclarations', () => {
  it('refuses a defineColumnExtension call in a workspace module package', () => {
    expect(() =>
      assertNoSchemaExtensionDeclarations(
        packageSources(workspaceModule, { 'src/backend/columns.ts': DECLARATION }),
      ),
    ).toThrow(/workspace module package.*acme_erp/s);
  });

  it('refuses a schemaExtensions export in a workspace module package', () => {
    expect(() =>
      assertNoSchemaExtensionDeclarations(
        packageSources(workspaceModule, {
          'src/backend/index.ts': "import { x } from './x.js';\nexport const schemaExtensions = [x];\n",
        }),
      ),
    ).toThrow(/schemaExtensions/);
  });

  it('passes a declaration in an overlay module — read at runtime, validated there (OR-3)', () => {
    // `specs/190-overlay-full-modules/` contract `overlay-schema-discovery.md` §5:
    // an overlay module declares extension columns as an installed package does,
    // and the platform holds them to V9 – V11 when it reads the overlay.
    expect(() =>
      assertNoSchemaExtensionDeclarations(
        coreSources({ 'apps/example/modules/example_overlay/backend.ts': DECLARATION }),
      ),
    ).not.toThrow();
  });

  it('refuses one under a deployment but outside its overlay modules — nothing would read it', () => {
    // `specs/190-overlay-full-modules/` FR-065: the platform reads an overlay
    // module's `backend` export; a declaration beside `divergence.ts` would be
    // accepted here and then silently never declare anything.
    expect(() =>
      assertNoSchemaExtensionDeclarations(coreSources({ 'apps/example/columns.ts': DECLARATION })),
    ).toThrow(/application's own tree/);
  });

  it('still refuses one in the application tree outside `apps/`', () => {
    expect(() =>
      assertNoSchemaExtensionDeclarations(coreSources({ 'kernel/columns.ts': DECLARATION })),
    ).toThrow(/application's own tree/);
  });

  it('passes a tree that only mentions the API in a comment or a string', () => {
    expect(() =>
      assertNoSchemaExtensionDeclarations(
        mergeSources(
          coreSources({
            'kernel/doc.ts': "// defineColumnExtension({ host: 'organizations' })\nexport const s = 'schemaExtensions';\n",
          }),
          packageSources(workspaceModule, { 'src/backend/index.ts': 'export const entities = [];\n' }),
        ),
      ),
    ).not.toThrow();
  });
});
