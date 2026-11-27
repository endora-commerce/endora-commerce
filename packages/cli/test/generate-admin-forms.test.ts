/**
 * `endora generate` and the admin-forms analysis (`specs/193-admin-form-extensions/`
 * T032, FR-012; `contracts/field-slots.md` §6): the instance's reader of the
 * analysis `check:admin-forms` runs here. It judges the installed packages and
 * each deployment's overlay modules over them, writes every artefact first, and
 * then refuses a run with a refusal — exit 1 — while a warning refuses nothing.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateFindingsRefusal, generateReport, runGenerate } from '../src/generate/index.js';
import { cleanInstances, instance, installModule, write, SCOPE } from './support/overlay-instance.js';

afterEach(() => {
  cleanInstances();
});

/** `organizations`, installed, declaring a field set and one form its own release renders. */
function installOrganizations(root: string): void {
  installModule(root, 'organizations');
  write(
    join(root, 'node_modules', SCOPE, 'mod-organizations', 'dist', 'manifest.js'),
    `export const manifest = {
  id: 'organizations',
  fieldSets: [{ id: 'organization', ownerModuleId: 'organizations', fields: [{ key: 'name' }, { key: 'taxId' }] }],
  adminForms: [{ id: 'organization.edit', fieldSet: 'organization', sections: [{ key: 'identity', keys: ['name', 'taxId'] }] }],
};
`,
  );
}

function slot(anchor: string): string {
  return `import type { AdminContributions } from '${SCOPE}/admin-kit/contributions';

export const contributions: AdminContributions = {
  fields: [
    {
      fieldSet: 'organization',
      key: 'erpCode',
      type: 'string',
      anchor: { field: '${anchor}', position: 'after' },
      weight: 0,
      labelKey: 'fields.erpCode',
      component: () => import('./ErpCode.js'),
    },
  ],
};
`;
}

/** An instance with an admin member, `organizations` installed and one overlay slot module. */
function withSlot(options: { anchor?: string; dependsOnOwner?: boolean } = {}): string {
  const root = instance({ deployments: ['acme'] });
  write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - backend\n  - admin\n');
  write(join(root, 'admin', 'package.json'), JSON.stringify({ name: 'acme-shop-admin' }));
  write(
    join(root, 'admin', 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
  );
  installOrganizations(root);
  const erp = join(root, 'apps', 'acme', 'modules', 'acme_erp');
  write(
    join(erp, 'manifest.ts'),
    `export const manifest = {\n  id: 'acme_erp',\n  dependencies: [${options.dependsOnOwner === false ? '' : "'organizations'"}],\n` +
      `  actions: [{ id: 'open-acme', targetRoute: '/acme' }],\n};\n`,
  );
  write(join(erp, 'admin', 'index.tsx'), slot(options.anchor ?? 'taxId'));
  return root;
}

describe('endora generate — admin forms (193 FR-012)', () => {
  it('is clean for a dependent overlay slot on an installed field set, and says what it judged', async () => {
    const result = await runGenerate({ cwd: withSlot() });
    expect(generateFindingsRefusal(result)).toBeNull();
    expect(generateReport(result)).toContain('admin forms of acme: 1 declaration(s), clean');
  });

  it('writes the artefacts and then refuses an anchor the field set does not declare', async () => {
    const root = withSlot({ anchor: 'vatId' });
    const result = await runGenerate({ cwd: root });
    expect(existsSync(join(root, 'admin', 'src', 'deployments', 'acme.generated.ts'))).toBe(true);
    const report = generateReport(result);
    expect(report.some((line) => line.includes('[unknown-anchor] apps/acme/modules/acme_erp/admin/index.tsx'))).toBe(true);
    const refusal = generateFindingsRefusal(result);
    expect(refusal).toContain('the admin forms are not clean: 1 refusal(s)');
    expect(refusal).toContain('[unknown-anchor]');
  });

  it('refuses a slot module that does not depend on the field set owner', async () => {
    const result = await runGenerate({ cwd: withSlot({ dependsOnOwner: false }) });
    expect(generateFindingsRefusal(result)).toContain('[slot-owner-not-a-dependency]');
  });

  it("does not report an installed package's own form as unrendered: its host shipped in its release", async () => {
    const result = await runGenerate({ cwd: withSlot() });
    expect(generateReport(result).join('\n')).not.toContain('unrendered-form');
  });
});
