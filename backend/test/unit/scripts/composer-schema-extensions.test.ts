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
 * Declared extension columns are an **installed** package's mechanism: a
 * first-party module owns its tables or ships a side table, and an overlay
 * module ships no schema at all (D-106). So the composer, which walks every
 * workspace source, refuses a declaration wherever it finds one — by the call
 * and by the export, read off the syntax tree so a comment quoting either does
 * not trip it.
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

  it('refuses a declaration in an overlay module', () => {
    expect(() =>
      assertNoSchemaExtensionDeclarations(
        coreSources({ 'apps/example/modules/example_overlay/backend.ts': DECLARATION }),
      ),
    ).toThrow(/overlay/i);
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
