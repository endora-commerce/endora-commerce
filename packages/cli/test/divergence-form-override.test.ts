/**
 * `specs/193-admin-form-extensions/` T031 (FR-051, FR-070;
 * `contracts/field-overrides.md` §4 and §5) — a deployment's field overrides
 * and its grants to installed packages are divergences of their own kinds.
 *
 *  - `form-override`, keyed `form-override:<module>:<fieldSet>.<field>`, derived
 *    from the overlay module's **manifest** declaration (as `command-middleware`
 *    is), rung 2, with the kinds it sets and whether they are presentation only.
 *    Owned by the field set's owner.
 *  - `form-override-grant`, keyed `form-override-grant:<module>:<fieldSet>`,
 *    derived from the deployment's `divergence.ts` — the grant carries its own
 *    reason, as an omission does, so it is never `undeclared-divergence`.
 *  - Slot fields are the module's own surface: `notRecorded`, with a reason.
 *
 * Pure over `deriveDivergence`, so the fixture sources enter at the top of the
 * analysis; the declaration enters as the source text the CLI reads.
 */
import { describe, expect, it } from 'vitest';

import { deriveDivergence, type DivergenceInput } from '../src/lib/divergence.js';
import { readDivergenceDeclaration, renderDivergenceMarkdown } from '../src/lib/divergence-artefacts.js';

const MANIFEST = (id: string, overrides: string): string => `
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: '${id}',
  name: '${id}',
  version: '1.0.0',
  dependencies: ['organizations'],
  formOverrides: ${overrides},
});
`;

const NIP = MANIFEST(
  'acme_nip',
  `[
    { target: 'organization.taxId', labelKey: 'fields.nip', helpKey: 'fields.nipHelp', reason: 'Polish buyers know it as NIP.' },
    { target: 'organization.taxId', forms: ['organization.create'], validation: { pattern: '^[0-9]{10}$' }, reason: 'Ten digits.' },
    { target: 'organization.parentId', hidden: true, reason: 'No group structures here.' },
  ]`,
);

function input(
  manifests: Record<string, string>,
  declaration: Partial<DivergenceInput['declaration']> = {},
  /** `null`: a host that cannot attribute field sets passes none. */
  fieldSetOwners: ReadonlyMap<string, string> | null = new Map([['organization', 'organizations']]),
): DivergenceInput {
  return {
    deployment: 'acme',
    overlayRoot: 'backend/src/apps/acme/modules',
    overlayModules: Object.keys(manifests),
    sources: Object.entries(manifests).map(([moduleId, text]) => ({
      moduleId,
      file: `backend/src/apps/acme/modules/${moduleId}/manifest.ts`,
      text,
    })),
    routes: new Map(),
    owners: new Map(),
    rootSupplied: new Set(),
    ...(fieldSetOwners === null ? {} : { fieldSetOwners }),
    declaration: { omittedModules: [], decorationOrder: {}, reasons: {}, ...declaration },
    seams: [],
  };
}

describe('the `form-override` divergence kind (193 T031, FR-070)', () => {
  it('records one entry per overriding module and target, merging the kinds it sets', () => {
    const { report } = deriveDivergence(input({ acme_nip: NIP }));
    expect(report.entries.filter((entry) => entry.kind === 'form-override')).toEqual([
      {
        key: 'form-override:acme_nip:organization.parentId',
        kind: 'form-override',
        module: 'acme_nip',
        subject: 'organization.parentId',
        owner: 'organizations',
        rung: 2,
        detail: { kind: 'form-override', kinds: ['hidden'], presentationOnly: true },
        reason: '',
      },
      {
        key: 'form-override:acme_nip:organization.taxId',
        kind: 'form-override',
        module: 'acme_nip',
        subject: 'organization.taxId',
        owner: 'organizations',
        rung: 2,
        detail: { kind: 'form-override', kinds: ['label', 'help', 'validation'], presentationOnly: false },
        reason: '',
      },
    ]);
    expect(report.boundary.recorded).toContain('form-override');
  });

  it('asks the deployment for a reason per entry, and calls an unmatched one stale', () => {
    const undeclared = deriveDivergence(input({ acme_nip: NIP })).findings.filter((f) => f.kind === 'undeclared-divergence');
    expect(undeclared.map((finding) => finding.detail.split('`')[1])).toEqual([
      'form-override:acme_nip:organization.parentId',
      'form-override:acme_nip:organization.taxId',
    ]);
    const reasons = {
      'form-override:acme_nip:organization.taxId': 'Polish buyers enter a NIP, ten digits, nothing else.',
      'form-override:acme_nip:organization.parentId': 'This deployment sells to single companies, never groups.',
      'form-override:acme_nip:organization.emails': 'A target this tree no longer overrides at all.',
    };
    const { findings } = deriveDivergence(input({ acme_nip: NIP }, { reasons }));
    expect(findings.filter((finding) => finding.kind === 'undeclared-divergence')).toEqual([]);
    expect(findings.filter((finding) => finding.kind === 'stale-reason').map((finding) => finding.detail)).toEqual([
      '`form-override:acme_nip:organization.emails` describes no divergence in this tree',
    ]);
  });

  it('refuses an override on a field set no module in the composition owns', () => {
    const { report, findings } = deriveDivergence(
      input({ acme_nip: MANIFEST('acme_nip', "[{ target: 'organisation.taxId', hidden: true, reason: 'x' }]") }),
    );
    expect(report.entries.filter((entry) => entry.kind === 'form-override')).toEqual([]);
    expect(findings.filter((finding) => finding.kind === 'unowned-subject').map((finding) => finding.detail)).toEqual([
      "'organisation' is a field set no module in the composition declares, so no module owns the field this override changes",
    ]);
  });

  it('names the owner null where the host cannot attribute field sets', () => {
    const { report } = deriveDivergence(input({ acme_nip: NIP }, {}, null));
    expect(report.entries.filter((entry) => entry.kind === 'form-override').map((entry) => entry.owner)).toEqual([null, null]);
  });

  it('reports a declaration it cannot read as literals as computed-subject, never as no override', () => {
    const { report, findings } = deriveDivergence(
      input({ acme_nip: MANIFEST('acme_nip', "[...OVERRIDES, { target: 'organization.taxId', hidden: true, reason: 'x' }]") }),
    );
    // The spread is named; the entry written in place beside it is still recorded.
    expect(findings.filter((finding) => finding.kind === 'computed-subject').map((finding) => finding.detail)).toEqual([
      '`formOverrides` declares an override the analysis cannot read as literals: ...OVERRIDES',
    ]);
    expect(report.entries.filter((entry) => entry.kind === 'form-override').map((entry) => entry.subject)).toEqual([
      'organization.taxId',
    ]);
    const computedTarget = deriveDivergence(
      input({ acme_nip: MANIFEST('acme_nip', "[{ target: TARGET, hidden: true, reason: 'x' }]") }),
    );
    expect(computedTarget.report.entries.filter((entry) => entry.kind === 'form-override')).toEqual([]);
    expect(computedTarget.findings.filter((finding) => finding.kind === 'computed-subject')).toHaveLength(1);
  });

  it('renders under its own heading in the human report', () => {
    const markdown = renderDivergenceMarkdown(deriveDivergence(input({ acme_nip: NIP })).report);
    expect(markdown).toContain('### Fields this deployment overrides on another module’s forms');
    expect(markdown).toContain('`organization.taxId` (label, help, validation)');
  });
});

describe('the `form-override-grant` divergence kind (193 T031, FR-051, D-300.2)', () => {
  const GRANTS = {
    organization: [{ moduleId: 'pim_tax', packageName: '@acme/pim-tax', reason: 'The PIM tax package relabels the tax id.' }],
  };

  it('records each grant, carrying its own reason, rung 2, owned by the field set owner', () => {
    const { report, findings } = deriveDivergence(input({}, { formOverrideGrants: GRANTS }));
    expect(report.entries.filter((entry) => entry.kind === 'form-override-grant')).toEqual([
      {
        key: 'form-override-grant:pim_tax:organization',
        kind: 'form-override-grant',
        module: 'pim_tax',
        subject: 'organization',
        owner: 'organizations',
        rung: 2,
        detail: { kind: 'form-override-grant', packageName: '@acme/pim-tax' },
        reason: 'The PIM tax package relabels the tax id.',
      },
    ]);
    expect(findings.filter((finding) => finding.kind === 'undeclared-divergence')).toEqual([]);
    expect(report.boundary.recorded).toContain('form-override-grant');
  });

  it('is read out of `divergence.ts` by the CLI, which dropped it before (issue #2020)', () => {
    const reading = readDivergenceDeclaration(
      `export const divergence = {
        omittedModules: [],
        decorationOrder: {},
        reasons: {},
        formOverrideGrants: {
          organization: [{ moduleId: 'pim_tax', packageName: '@acme/pim-tax', reason: 'The PIM tax package relabels the tax id.' }],
        },
      };`,
      'apps/acme/divergence.ts',
    );
    expect(reading.unresolved).toEqual([]);
    expect(reading.declaration.formOverrideGrants).toEqual(GRANTS);
  });

  it('names a grant it cannot read rather than reading it as none', () => {
    const reading = readDivergenceDeclaration(
      `export const divergence = { formOverrideGrants: { organization: GRANTS } };`,
      'apps/acme/divergence.ts',
    );
    expect(reading.unresolved).toEqual(['formOverrideGrants.organization (not a literal array of grants)']);
    expect(reading.declaration.formOverrideGrants).toBeUndefined();
  });
});

describe('slot fields are not recorded (FR-070)', () => {
  it('states why in the boundary, beside the other own-surface seams', () => {
    const { report } = deriveDivergence(input({}));
    expect(report.boundary.notRecorded.map((entry) => entry.seam)).toContain(
      "an admin layer's slot fields (`AdminContributions.fields`)",
    );
  });
});
