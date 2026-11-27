import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import * as rule from '@endora-commerce/cli/lib/admin-forms.js';

import * as host from '../../../scripts/check-admin-forms.js';
import {
  adminFormsOverSources,
  deploymentRegistryModules,
  judgeAdminForms,
  readOverlayDeployment,
  vacuousAdminFormsReason,
  type AdminFormsFindingKind,
  type AdminFormsReadRecord,
} from '../../../scripts/check-admin-forms.js';

/**
 * Companion test for `check-admin-forms` (`specs/193-admin-form-extensions/`
 * T033; `contracts/field-slots.md` §6).
 *
 * The check lands at **zero declarations**: no module declares a field set
 * until the first adopter (WP-E1), so nothing in the tree exercises it and this
 * file carries the claim. The analysis' own one-case-per-code proofs are the
 * package's (`packages/cli/src/lib/admin-forms.test.ts`); what is proven here
 * is the **host**: it re-exports the package's analysis rather than a copy, it
 * refuses each input whose absence would make a predicate vacuously clean, it
 * reads a deployment off disk with the instance's own reader and judges it over
 * bare core, and it reconciles a deployment registry against what it read.
 */

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

const ORGANIZATIONS = {
  id: 'organizations',
  fieldSets: [{ id: 'organization', ownerModuleId: 'organizations', fields: [{ key: 'name' }, { key: 'taxId' }] }],
  adminForms: [{ id: 'organization.edit', fieldSet: 'organization', sections: [{ key: 'identity', keys: ['name', 'taxId'] }] }],
};
const HOST = `import { ORGANIZATION_FORMS } from '@endora-commerce/contracts';
export const Edit = () => <DeclaredFormProvider form={ORGANIZATION_FORMS.edit} />;
`;
const EXPORTS = { '@endora-commerce/contracts': { ORGANIZATION_FORMS: { edit: ORGANIZATIONS.adminForms[0] } } };

function slotLayer(anchor: string): string {
  return `export const contributions = {
  fields: [{ fieldSet: 'organization', key: 'erpCode', type: 'string', weight: 0, labelKey: 'a',
    anchor: { field: '${anchor}', position: 'after' }, component: () => import('./X.js') }],
};
`;
}

describe('check-admin-forms — the host over the relocated analysis', () => {
  it('re-exports the package’s analysis objects, not a copy', () => {
    const exported = Object.keys(rule);
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) expect((host as Record<string, unknown>)[name]).toBe((rule as Record<string, unknown>)[name]);
  });

  it('is clean over a compliant core, and red over a slot on an undeclared key', () => {
    const core = {
      manifests: [ORGANIZATIONS, { id: 'acme_erp', dependencies: ['organizations'] }],
      hosts: { 'organizations/admin/Edit.tsx': HOST },
      exports: EXPORTS,
    };
    expect(adminFormsOverSources({ ...core, layers: { acme_erp: { file: 'a.tsx', source: slotLayer('taxId') } } }).findings).toEqual([]);
    const red = adminFormsOverSources({ ...core, layers: { acme_erp: { file: 'a.tsx', source: slotLayer('vatId') } } });
    expect(red.findings.map((finding) => finding.kind)).toEqual<AdminFormsFindingKind[]>(['unknown-anchor']);
  });
});

describe('check-admin-forms — what it refuses to report a pass over (exit 2)', () => {
  const COMPLETE: AdminFormsReadRecord = {
    adminApplication: true,
    registryPresent: true,
    registryLayers: 50,
    manifests: 70,
    hostFiles: 900,
  };

  it('reports nothing over a complete read', () => {
    expect(vacuousAdminFormsReason(COMPLETE)).toBeNull();
  });

  it.each<[string, Partial<AdminFormsReadRecord>, RegExp]>([
    ['no admin application', { adminApplication: false }, /admin application/],
    ['no admin registry', { registryPresent: false }, /registry is not on disk/],
    ['a registry naming no layer', { registryLayers: 0 }, /names no module admin layer/],
    ['no manifest', { manifests: 0 }, /no manifest/],
    ['no host source', { hostFiles: 0 }, /no host source/],
  ])('refuses %s', (_name, change, message) => {
    expect(vacuousAdminFormsReason({ ...COMPLETE, ...change })).toMatch(message);
  });
});

describe('check-admin-forms — a deployment on disk, judged over bare core', () => {
  function deploymentTree(): string {
    const root = mkdtempSync(join(tmpdir(), 'check-admin-forms-'));
    scratch.push(root);
    const erp = join(root, 'apps', 'acme', 'modules', 'acme_erp');
    write(join(erp, 'manifest.ts'), "export const manifest = { id: 'acme_erp', dependencies: [] };\n");
    write(join(erp, 'admin', 'index.tsx'), slotLayer('taxId'));
    return root;
  }

  it('reads the overlay with the instance reader and reports only what the deployment adds', async () => {
    const root = deploymentTree();
    const population = await readOverlayDeployment(join(root, 'apps'), 'acme', root);
    expect(population.files).toBeGreaterThan(0);
    expect(population.layers.map((layer) => layer.moduleId)).toEqual(['acme_erp']);
    const base = { modules: [rule.formsModuleFromManifest(ORGANIZATIONS, 'o').module!], layers: [], renders: [], unreadable: [], files: 1 };
    const [core, acme] = judgeAdminForms(base, [{ deployment: 'acme', population }]);
    // Bare core lists a form no host in this fixture renders; the deployment
    // does not repeat that finding, and adds its own.
    expect(core!.findings.map((finding) => finding.kind)).toEqual(['unrendered-form']);
    expect(acme!.findings.map((finding) => `${finding.kind} ${finding.where}`)).toEqual([
      'slot-owner-not-a-dependency apps/acme/modules/acme_erp/admin/index.tsx:2',
    ]);
  });

  it('reads the overlay layers a generated deployment registry imports', () => {
    expect(
      deploymentRegistryModules(
        "import type { AdminRegistryEntry } from '../modules.generated.js';\n" +
          "import { contributions as contributions0 } from '../../../backend/src/apps/example/modules/example_erp_keys/admin/index.js';\n" +
          "import { contributions as contributions1 } from '../../../backend/src/apps/example/modules/overlay_notes_fixture/admin/index.js';\n",
      ),
    ).toEqual(['example_erp_keys', 'overlay_notes_fixture']);
  });
});
