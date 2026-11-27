/**
 * `specs/193-admin-form-extensions/` T030 (FR-002, FR-012, FR-031; SC-003,
 * SC-005) — the `admin-forms` analysis: one red case per finding code in
 * `contracts/field-slots.md` §6, the layout algorithm of §5 over the shared
 * vectors, and the same layout under shuffled registration.
 *
 * Every case enters at the top of the analysis (issue #130): an admin layer and
 * a host screen as **source text**, through the readers a real run uses, and a
 * manifest as the value an import of it yields. A fixture handing the
 * classifier pre-read slots would prove the classifier and leave the readers
 * above it unproven.
 */
import { describe, expect, it } from 'vitest';

import { FORM_LAYOUT_VECTORS, type FormLayoutVector } from '@endora-commerce/contracts/admin-forms.vectors';

import {
  ADMIN_FORMS_REMEDIES,
  adminFormsExitCode,
  adminFormsFindings,
  formLayout,
  formRenderSitesIn,
  formsModuleFromManifest,
  readAdminLayerForms,
  readManifestForms,
  resolveFormRenders,
  type AdminFormsFinding,
  type AdminFormsFindingKind,
  type FormsLayer,
  type FormsModule,
} from './admin-forms.js';

// ---------------------------------------------------------------------------
// Fixture: an owner with a field set and two forms, as manifests and sources
// ---------------------------------------------------------------------------

const ORGANIZATION_SET = {
  id: 'organization',
  ownerModuleId: 'organizations',
  fields: [
    { key: 'name', type: 'string', required: true, accepts: ['label'] },
    { key: 'taxId', type: 'string', required: true, accepts: ['label'], deprecatedAliases: [{ key: 'nip', since: '0.113.0' }] },
    { key: 'parentId', type: 'reference', required: false, accepts: ['label', 'hidden'] },
    { key: 'registeredAddress', type: 'composite', required: true, accepts: ['label'] },
  ],
};
const CREATE_FORM = {
  id: 'organization.create',
  fieldSet: 'organization',
  mode: 'create',
  sections: [
    { key: 'identity', keys: ['name', 'taxId', 'parentId'] },
    { key: 'address', keys: ['registeredAddress'] },
  ],
};
const EDIT_FORM = {
  id: 'organization.edit',
  fieldSet: 'organization',
  mode: 'edit',
  sections: [{ key: 'identity', keys: ['name', 'taxId', 'parentId'] }],
};

const ORGANIZATIONS_MANIFEST = {
  id: 'organizations',
  dependencies: [],
  fieldSets: [ORGANIZATION_SET],
  adminForms: [CREATE_FORM, EDIT_FORM],
};

/** The host screen that renders both forms, through the contracts constant. */
const ORGANIZATION_HOST = `
import { ORGANIZATION_FORMS } from '@endora-commerce/contracts';
import { DeclaredFormProvider } from '@endora-commerce/admin-kit/forms';

export function OrganizationForm({ mode }: { mode: 'create' | 'edit' }) {
  return (
    <DeclaredFormProvider form={mode === 'create' ? ORGANIZATION_FORMS.create : ORGANIZATION_FORMS.edit} values={{}}>
      <span />
    </DeclaredFormProvider>
  );
}
`;

/** What `import('@endora-commerce/contracts')` would answer for the host above. */
const CONTRACTS_EXPORTS: Record<string, unknown> = {
  ORGANIZATION_FORMS: { create: CREATE_FORM, edit: EDIT_FORM },
};

async function importer(specifier: string): Promise<unknown> {
  if (specifier === '@endora-commerce/contracts') return CONTRACTS_EXPORTS;
  throw new Error(`no module ${specifier}`);
}

function layerSource(fields: string, controls = ''): string {
  return `
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

const ANCHOR = 'taxId';

export const contributions: AdminContributions = {
  fields: [${fields}],
  ${controls === '' ? '' : `controls: [${controls}],`}
};
`;
}

const ERP_SLOT = `{
    fieldSet: 'organization',
    key: 'erpCode',
    type: 'string',
    anchor: { field: ANCHOR, position: 'after' },
    weight: 10,
    labelKey: 'fields.erpCode',
    component: () => import('./ErpCode.js'),
  }`;

interface Fixture {
  readonly manifests?: Readonly<Record<string, Record<string, unknown>>>;
  readonly layers?: Readonly<Record<string, string>>;
  readonly hosts?: Readonly<Record<string, string>>;
}

const ERP_MANIFEST = { id: 'acme_erp', dependencies: ['organizations'] };

async function analyse(fixture: Fixture): Promise<{ findings: AdminFormsFinding[]; unreadable: string[] }> {
  const manifests = fixture.manifests ?? { organizations: ORGANIZATIONS_MANIFEST, acme_erp: ERP_MANIFEST };
  const unreadable: string[] = [];
  const modules: FormsModule[] = [];
  for (const [id, manifest] of Object.entries(manifests)) {
    const read = formsModuleFromManifest(manifest, `${id}/manifest.ts`);
    unreadable.push(...read.unreadable);
    if (read.module !== null) modules.push(read.module);
  }
  const layers: FormsLayer[] = [];
  for (const [id, source] of Object.entries(fixture.layers ?? {})) {
    const read = readAdminLayerForms(id, `${id}/admin/index.tsx`, source);
    unreadable.push(...read.unreadable);
    layers.push(read.layer);
  }
  const references = Object.entries(fixture.hosts ?? { 'organizations/admin/OrganizationForm.tsx': ORGANIZATION_HOST }).flatMap(
    ([file, source]) => {
      const read = formRenderSitesIn(file, source);
      unreadable.push(...read.unreadable);
      return read.references;
    },
  );
  const resolved = await resolveFormRenders(references, importer);
  unreadable.push(...resolved.unreadable);
  return { findings: adminFormsFindings({ modules, layers, renders: resolved.renders }), unreadable };
}

function kinds(findings: readonly AdminFormsFinding[], kind: AdminFormsFindingKind): AdminFormsFinding[] {
  return findings.filter((finding) => finding.kind === kind);
}

// ---------------------------------------------------------------------------
// The clean tree, so every red case below is a single change away from it
// ---------------------------------------------------------------------------

describe('the admin-forms analysis over a compliant tree', () => {
  it('reports nothing for an owner, its rendered forms and a dependent slot module', async () => {
    const { findings, unreadable } = await analyse({ layers: { acme_erp: layerSource(ERP_SLOT) } });
    expect(unreadable).toEqual([]);
    expect(findings).toEqual([]);
    expect(adminFormsExitCode(findings, unreadable)).toBe(0);
  });

  it('has a remedy for every finding code, and nothing else', () => {
    expect(Object.keys(ADMIN_FORMS_REMEDIES).sort()).toEqual(
      [
        'ambiguous-slot-order',
        'control-without-declaration',
        'declaration-without-control',
        'deprecated-anchor',
        'duplicate-slot-key',
        'foreign-slot-anchor',
        'position-anchor-mismatch',
        'slot-owner-not-a-dependency',
        'undeclared-form',
        'unknown-anchor',
        'unknown-field-set',
        'unknown-form',
        'unrendered-form',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// §6 — one red case per finding code
// ---------------------------------------------------------------------------

describe('§6 refusals', () => {
  it('unknown-field-set — a slot on a field set no manifest declares', async () => {
    const { findings } = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT.replace("fieldSet: 'organization'", "fieldSet: 'organisation'")) },
    });
    const found = kinds(findings, 'unknown-field-set');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'refusal', moduleId: 'acme_erp' });
    expect(found[0]!.detail).toContain("'organisation'");
    expect(adminFormsExitCode(findings, [])).toBe(1);
  });

  it('unknown-form — a slot narrowed to a form its field set does not have', async () => {
    const { findings } = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT.replace("key: 'erpCode',", "key: 'erpCode', forms: ['organization.view'],")) },
    });
    expect(kinds(findings, 'unknown-form')).toHaveLength(1);
    expect(kinds(findings, 'unknown-form')[0]!.detail).toContain("'organization.view'");
  });

  it('unknown-anchor — a field anchor the field set does not declare, naming the declared keys', async () => {
    const { findings } = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT.replace('field: ANCHOR', "field: 'vatId'")) },
    });
    const found = kinds(findings, 'unknown-anchor');
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toContain("'vatId'");
    expect(found[0]!.detail).toContain('name, taxId, parentId, registeredAddress');
  });

  it('unknown-anchor — a declared key, or a section, a targeted form does not show', async () => {
    // `registeredAddress` is a field of the set, but `organization.edit` does not
    // show it, so a slot on every form of the set has no place in that one.
    const field = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT.replace('field: ANCHOR', "field: 'registeredAddress'")) },
    });
    expect(kinds(field.findings, 'unknown-anchor')).toHaveLength(1);
    expect(kinds(field.findings, 'unknown-anchor')[0]!.detail).toContain("'organization.edit'");
    const section = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT.replace('field: ANCHOR', "section: 'address'").replace("'after'", "'end'")) },
    });
    expect(kinds(section.findings, 'unknown-anchor')).toHaveLength(1);
    expect(kinds(section.findings, 'unknown-anchor')[0]!.detail).toContain("'organization.edit'");
    // Narrowed to the form that shows it, the same slot is placed.
    const narrowed = await analyse({
      layers: {
        acme_erp: layerSource(
          ERP_SLOT.replace('field: ANCHOR', "field: 'registeredAddress'").replace(
            "key: 'erpCode',",
            "key: 'erpCode', forms: ['organization.create'],",
          ),
        ),
      },
    });
    expect(narrowed.findings).toEqual([]);
  });

  it('unknown-anchor — own-module slots anchored on each other, which no form can place', async () => {
    const pair = [
      "{ fieldSet: 'organization', key: 'a', type: 'string', weight: 0, labelKey: 'a', anchor: { field: 'acme_erp.b', position: 'after' } }",
      "{ fieldSet: 'organization', key: 'b', type: 'string', weight: 0, labelKey: 'b', anchor: { field: 'acme_erp.a', position: 'before' } }",
    ];
    const { findings } = await analyse({ layers: { acme_erp: layerSource(pair.join(', ')) } });
    const found = kinds(findings, 'unknown-anchor');
    expect(found.map((finding) => finding.subject)).toEqual(['acme_erp.a', 'acme_erp.b']);
    expect(found[0]!.detail).toContain('cycle');
  });

  it('foreign-slot-anchor — a slot anchored on another module’s slot', async () => {
    const other = `{
      fieldSet: 'organization', key: 'note', type: 'string', weight: 0, labelKey: 'fields.note',
      anchor: { field: 'acme_erp.erpCode', position: 'after' }, component: () => import('./Note.js'),
    }`;
    const { findings } = await analyse({
      manifests: {
        organizations: ORGANIZATIONS_MANIFEST,
        acme_erp: ERP_MANIFEST,
        acme_notes: { id: 'acme_notes', dependencies: ['organizations'] },
      },
      layers: { acme_erp: layerSource(ERP_SLOT), acme_notes: layerSource(other) },
    });
    const found = kinds(findings, 'foreign-slot-anchor');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ moduleId: 'acme_notes' });
  });

  it('position-anchor-mismatch — a field anchor with a section position', async () => {
    const { findings } = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT.replace("position: 'after'", "position: 'end'")) },
    });
    expect(kinds(findings, 'position-anchor-mismatch')).toHaveLength(1);
  });

  it('position-anchor-mismatch — a section anchor with a field position', async () => {
    const { findings } = await analyse({
      layers: {
        acme_erp: layerSource(ERP_SLOT.replace('field: ANCHOR', "section: 'identity'")),
      },
    });
    expect(kinds(findings, 'position-anchor-mismatch')).toHaveLength(1);
  });

  it('duplicate-slot-key — one module declaring one key twice on overlapping forms', async () => {
    const { findings } = await analyse({ layers: { acme_erp: layerSource(`${ERP_SLOT}, ${ERP_SLOT}`) } });
    expect(kinds(findings, 'duplicate-slot-key')).toHaveLength(1);
    // Two declarations of one key on disjoint forms are one field placed twice.
    const disjoint = await analyse({
      layers: {
        acme_erp: layerSource(
          `${ERP_SLOT.replace("key: 'erpCode',", "key: 'erpCode', forms: ['organization.create'],")}, ` +
            ERP_SLOT.replace("key: 'erpCode',", "key: 'erpCode', forms: ['organization.edit'],").replace(
              'field: ANCHOR',
              "field: 'name'",
            ),
        ),
      },
    });
    expect(kinds(disjoint.findings, 'duplicate-slot-key')).toEqual([]);
  });

  it('slot-owner-not-a-dependency — a slot module that does not depend on the owner', async () => {
    const { findings } = await analyse({
      manifests: { organizations: ORGANIZATIONS_MANIFEST, acme_erp: { id: 'acme_erp', dependencies: [] } },
      layers: { acme_erp: layerSource(ERP_SLOT) },
    });
    const found = kinds(findings, 'slot-owner-not-a-dependency');
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toContain("'organizations'");
  });

  it('undeclared-form — a host rendering a form no manifest lists', async () => {
    const { findings } = await analyse({
      manifests: {
        organizations: { ...ORGANIZATIONS_MANIFEST, adminForms: [CREATE_FORM] },
        acme_erp: ERP_MANIFEST,
      },
    });
    const found = kinds(findings, 'undeclared-form');
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe('organization.edit');
  });

  it('unrendered-form — a listed form no host renders', async () => {
    const { findings } = await analyse({
      hosts: {
        'organizations/admin/OrganizationCreate.tsx': ORGANIZATION_HOST.replace(
          "mode === 'create' ? ORGANIZATION_FORMS.create : ORGANIZATION_FORMS.edit",
          'ORGANIZATION_FORMS.create',
        ),
      },
    });
    const found = kinds(findings, 'unrendered-form');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ moduleId: 'organizations', subject: 'organization.edit' });
  });

  it('control-without-declaration — an admin control no manifest declares', async () => {
    const { findings } = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT, "{ id: 'acme_erp.code', component: () => import('./Code.js') }") },
    });
    const found = kinds(findings, 'control-without-declaration');
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe('acme_erp.code');
  });

  it('declaration-without-control — a declared control with no component', async () => {
    const { findings } = await analyse({
      manifests: {
        organizations: ORGANIZATIONS_MANIFEST,
        acme_erp: { ...ERP_MANIFEST, inputControls: [{ id: 'acme_erp.code', outputType: 'string' }] },
      },
      layers: { acme_erp: layerSource(ERP_SLOT) },
    });
    expect(kinds(findings, 'declaration-without-control')).toHaveLength(1);
    // Declared and supplied: neither direction.
    const paired = await analyse({
      manifests: {
        organizations: ORGANIZATIONS_MANIFEST,
        acme_erp: { ...ERP_MANIFEST, inputControls: [{ id: 'acme_erp.code', outputType: 'string' }] },
      },
      layers: { acme_erp: layerSource(ERP_SLOT, "{ id: 'acme_erp.code', component: () => import('./Code.js') }") },
    });
    expect(paired.findings).toEqual([]);
  });
});

describe('§6 warnings', () => {
  it('ambiguous-slot-order — two modules, one anchor, one position, one weight; the run still passes', async () => {
    const other = ERP_SLOT.replace("key: 'erpCode'", "key: 'vatCode'");
    const { findings } = await analyse({
      manifests: {
        organizations: ORGANIZATIONS_MANIFEST,
        acme_erp: ERP_MANIFEST,
        acme_vat: { id: 'acme_vat', dependencies: ['organizations'] },
      },
      layers: { acme_erp: layerSource(ERP_SLOT), acme_vat: layerSource(other) },
    });
    const found = kinds(findings, 'ambiguous-slot-order');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning' });
    expect(found[0]!.detail).toContain('acme_erp.erpCode');
    expect(found[0]!.detail).toContain('acme_vat.vatCode');
    expect(adminFormsExitCode(findings, [])).toBe(0);
  });

  it('deprecated-anchor — an anchor naming a deprecated alias resolves to the live key, warned', async () => {
    const { findings } = await analyse({
      layers: { acme_erp: layerSource(ERP_SLOT.replace('field: ANCHOR', "field: 'nip'")) },
    });
    expect(kinds(findings, 'deprecated-anchor')).toHaveLength(1);
    expect(kinds(findings, 'deprecated-anchor')[0]!.detail).toContain("'taxId'");
    expect(kinds(findings, 'unknown-anchor')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The readers: what they cannot read is named, never skipped (issue #113)
// ---------------------------------------------------------------------------

describe('the readers', () => {
  it('names a slot it cannot read as literals rather than reading it as absent', () => {
    const read = readAdminLayerForms(
      'acme_erp',
      'acme_erp/admin/index.tsx',
      layerSource(`{ fieldSet: SET, key: 'erpCode', type: 'string', anchor: { field: 'name', position: 'after' }, weight: 0, labelKey: 'a' }`),
    );
    expect(read.layer.slots).toEqual([]);
    expect(read.unreadable).toHaveLength(1);
    expect(adminFormsExitCode([], read.unreadable)).toBe(1);
  });

  it('names a host form it cannot resolve rather than counting it as rendered', async () => {
    const read = formRenderSitesIn('x.tsx', '<DeclaredFormProvider form={pickForm()} />');
    expect(read.references).toEqual([]);
    expect(read.unreadable).toHaveLength(1);
    const unresolved = await resolveFormRenders(
      formRenderSitesIn('y.tsx', "import { MISSING } from '@endora-commerce/contracts';\n<DeclaredFormProvider form={MISSING} />")
        .references,
      importer,
    );
    expect(unresolved.renders).toEqual([]);
    expect(unresolved.unreadable).toHaveLength(1);
  });

  it('reads a compiled render site (`jsx(DeclaredFormProvider, { form })`) as one', async () => {
    const compiled =
      "import { jsx as _jsx } from 'react/jsx-runtime';\nimport { ORGANIZATION_FORMS } from '@endora-commerce/contracts';\n" +
      'export const F = () => _jsx(DeclaredFormProvider, { form: ORGANIZATION_FORMS.create });\n';
    const { renders } = await resolveFormRenders(formRenderSitesIn('f.js', compiled).references, importer);
    expect(renders.map((render) => render.formId)).toEqual(['organization.create']);
  });

  it('reads an overlay manifest’s literal declarations, and names the ones it cannot read', () => {
    const literal = readManifestForms(
      'acme_erp',
      'acme_erp/manifest.ts',
      `export const manifest = defineModuleManifest({
        id: 'acme_erp', dependencies: ['organizations'],
        inputControls: [{ id: 'acme_erp.code', outputType: 'string' }],
      });`,
    );
    expect(literal.unreadable).toEqual([]);
    expect(literal.module).toMatchObject({ moduleId: 'acme_erp', dependencies: ['organizations'], inputControls: ['acme_erp.code'] });
    const computed = readManifestForms(
      'acme_erp',
      'acme_erp/manifest.ts',
      `import { ACME_SET } from './forms.js';\nexport const manifest = { id: 'acme_erp', fieldSets: [ACME_SET] };`,
    );
    expect(computed.unreadable).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §5 — the layout, over the shared vectors, and under shuffled registration
// ---------------------------------------------------------------------------

function layoutOf(vector: FormLayoutVector, order: (n: number) => number[] = (n) => [...Array(n).keys()]) {
  const slots = vector.slots ?? [];
  const moves = vector.moves ?? [];
  return formLayout({
    sections: vector.sections,
    hidden: vector.hidden ?? [],
    visibleWhen: vector.visibleWhen ?? {},
    values: vector.values ?? {},
    slots: order(slots.length).map((index) => slots[index]!),
    moves: order(moves.length).map((index) => moves[index]!),
  });
}

/** A deterministic permutation, so a failure names a reproducible order. */
function permutation(seed: number): (n: number) => number[] {
  return (n) => {
    const indexes = [...Array(n).keys()];
    let state = seed;
    for (let i = n - 1; i > 0; i -= 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const j = state % (i + 1);
      [indexes[i], indexes[j]] = [indexes[j]!, indexes[i]!];
    }
    return indexes;
  };
}

describe('§5 layout (shared vectors)', () => {
  for (const vector of FORM_LAYOUT_VECTORS) {
    it(vector.name, () => {
      expect(layoutOf(vector).map((section) => ({ section: section.key, items: section.items.map((item) => item.key) }))).toEqual(
        vector.expected,
      );
    });
  }
});

describe('§5 layout is deterministic under shuffled registration (SC-005)', () => {
  for (const vector of FORM_LAYOUT_VECTORS) {
    it(vector.name, () => {
      const reference = JSON.stringify(layoutOf(vector));
      for (let seed = 1; seed <= 50; seed += 1) {
        expect(JSON.stringify(layoutOf(vector, permutation(seed))), `seed ${String(seed)}`).toBe(reference);
      }
      // Reversed registration, the order a second process reading the registry backwards would see.
      expect(JSON.stringify(layoutOf(vector, (n) => [...Array(n).keys()].reverse()))).toBe(reference);
    });
  }

  it('the analysis’ findings do not depend on registration order either', async () => {
    const slots = [
      ERP_SLOT,
      ERP_SLOT.replace("key: 'erpCode'", "key: 'other'"),
    ];
    const forward = await analyse({
      manifests: {
        organizations: ORGANIZATIONS_MANIFEST,
        acme_erp: ERP_MANIFEST,
        acme_vat: { id: 'acme_vat', dependencies: ['organizations'] },
      },
      layers: { acme_erp: layerSource(slots.join(', ')), acme_vat: layerSource(ERP_SLOT.replace("key: 'erpCode'", "key: 'vat'")) },
    });
    const backward = await analyse({
      manifests: {
        acme_vat: { id: 'acme_vat', dependencies: ['organizations'] },
        acme_erp: ERP_MANIFEST,
        organizations: ORGANIZATIONS_MANIFEST,
      },
      layers: { acme_vat: layerSource(ERP_SLOT.replace("key: 'erpCode'", "key: 'vat'")), acme_erp: layerSource([...slots].reverse().join(', ')) },
    });
    expect(backward.findings).toEqual(forward.findings);
    expect(forward.findings.length).toBeGreaterThan(0);
  });
});
