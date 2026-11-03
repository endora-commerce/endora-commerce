import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import {
  REGISTERED_MANIFESTS,
  resolvedManifestEntries,
} from '../../../src/lifecycle/registered-manifests.js';
import { scanEnforcedPermissionGates } from '../../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import { permissionScanRoots } from '../../helpers/permission-scan-roots.js';
import {
  PermissionCatalogueService,
  listAssignablePermissionCodes,
} from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import {
  LEGACY_LABEL_MODULE_ID,
  LEGACY_PERMISSION_LABELS,
  compareToLegacyBlock,
  countLegacyLabelsByOwner,
  findPermissionLabelDefects,
  permissionLabelReadSize,
  walkPermissionLabels,
  type PermissionLabelInput,
} from '../../helpers/permission-labels.js';
import {
  findPermissionDependencyDefects,
  permissionDependencyReadSize,
  permissionDependencyRefusal,
  type PermissionDependencyInput,
} from '../../helpers/permission-dependencies.js';
import { readSizeLine, readSizeRefusal } from '../../../scripts/lib/read-size.js';
import { DEMO_ADMIN_ROLES } from '../../../../packages/modules/admin_roles/src/backend/demo/rows.js';
import {
  findOrganizationPermissionDefects,
  organizationPermissionReadSize,
  scanOrganizationPermissionSites,
  scanOrganizationPermissionSource,
  walkOrganizationPermissionDeclarations,
  type OrganizationPermissionFindingKind,
  type OrganizationPermissionInventoryInput,
} from '../../helpers/organization-permissions.js';

/**
 * The `/admin-roles` catalogue and the server's gates have to describe the same
 * set of codes, in both directions (feature 026, SC-001):
 *
 *  - a gate argument the scanner cannot read is a code nothing checks;
 *  - a code enforced but not assignable is a screen only a `'*'` role can open;
 *  - a code assignable but enforced nowhere is a checkbox that grants nothing;
 *  - a code with no `adminRoles.permission.<code>` entry falls back to the
 *    manifest label, which is English-only however many languages ship.
 *
 * The last of the four is the second `describe` below, and since feature 091's
 * Phase 3 it asks a sharper question than "is the label in `_i18n`": a module
 * owns its own labels, and what is left in the shared bundle is a ratcheted
 * legacy block.
 *
 * These sweeps replace a `toBe(<count>)` assertion that carried a per-feature
 * changelog: a number cannot say which side of the pair moved, and every feature
 * had to edit it whether or not anything was wrong.
 *
 * The scan is deployment-resolved on both sides — the gates under the active
 * overlay root and the manifests discovered for it (feature 057, FR-009) — so
 * `DEPLOYMENT=<name>` checks that deployment and a bare-core run checks core.
 */

/**
 * Deployment-resolved at module scope, with a top-level `await`: since D-104 the
 * deployment half of the manifest set is a runtime discovery rather than a
 * generated artefact's branch, so resolving it is asynchronous. It reads the
 * ambient `DEPLOYMENT`, which is what makes `DEPLOYMENT=<name>` sweep that
 * deployment's codes and a bare-core run sweep core's.
 */
const RESOLVED_MANIFESTS = await resolvedManifestEntries();

/**
 * Every directory this build enforces gates in — resolved by
 * `test/helpers/permission-scan-roots.ts`, which carries the reasoning.
 *
 * It used to be computed here. D-173's `foreign-gate` sweep asks a second
 * question of the same population, and two derivations of "where does this
 * build enforce gates" are two answers waiting to disagree — with the short one
 * reporting a clean tree.
 */
const SCAN_ROOTS = await permissionScanRoots();

describe('permission inventory (SC-001)', () => {
  const scan = scanEnforcedPermissionGates(SCAN_ROOTS);
  const assignable = listAssignablePermissionCodes(RESOLVED_MANIFESTS);

  it('resolves every enforcement site to a code, a bare admin gate or a runtime value', () => {
    const unresolved = scan.unresolved.map((site) => `${site.file}: ${site.expression}`);
    expect(
      unresolved,
      'gate arguments the inventory scanner cannot read — it therefore cannot ' +
        'check them, so either write the code as a literal or a resolvable ' +
        'constant, or teach the scanner the shape',
    ).toEqual([]);
    // Non-vacuity needs no count of its own: a scanner that stopped matching
    // would report no enforced code at all, and the reverse sweep below fails
    // on every assignable code at once.
  });

  it('every enforced code is assignable on /admin-roles', () => {
    const assignableSet = new Set(assignable);
    const missing = [...scan.codes].filter((code) => !assignableSet.has(code)).sort();
    const where = missing
      .map((code) => {
        const sites = scan.sites.filter((s) => s.codes.includes(code));
        return `${code} (${sites.map((s) => s.file).join(', ')})`;
      })
      .join('; ');
    expect(
      missing,
      `enforced but not grantable — declare each in the owning module's manifest ` +
        `\`permissions\`, or drop the gate: ${where}`,
    ).toEqual([]);
  });

  it('every assignable code is enforced somewhere', () => {
    const stale = assignable.filter((code) => !scan.codes.has(code)).sort();
    expect(
      stale,
      'grantable but enforced by no gate and no capability check — a checkbox ' +
        'on /admin-roles that grants nothing',
    ).toEqual([]);
  });

});

/**
 * A module owns its own permission labels — feature 091, Phase 3.
 *
 * `/admin-roles` translates every catalogue row through
 * `adminRoles.permission.<code>`, and until this phase that key had one home:
 * `_i18n`'s bundle, which no module installed from a registry can edit. The
 * rule is now the one every other module-owned string already follows, and
 * `_i18n`'s remaining labels are {@link LEGACY_PERMISSION_LABELS}, a two-way
 * ratchet in `test/helpers/permission-labels.ts`.
 *
 * The sweep is **core-only**, for the reason the inventory's label sweeps
 * always were: an overlay module is deployment-resolved and its bundle is not
 * in this repository's tree under a bare-core run.
 */
describe('permission labels (feature 091, Phase 3)', () => {
  const walk = walkPermissionLabels(REGISTERED_MANIFESTS);
  const owners = new PermissionCatalogueService({
    registryEntries: REGISTERED_MANIFESTS,
  }).listOwnersByCode();
  const input: PermissionLabelInput = {
    owners,
    bundles: walk.bundles,
    languages: SUPPORTED_LANGUAGES,
  };
  const findings = findPermissionLabelDefects(input);
  const counts = countLegacyLabelsByOwner(input);

  /**
   * What the sweep read, beside what it found (issue #244) — and the three
   * refusals that make "found nothing" distinguishable from "read nothing".
   *
   * The independent derivation is the generated manifest index: it says how
   * many modules declare a permission, the walk says how many of their
   * directories it located. A module tree that moved leaves every
   * `dirname(filePath)` pointing at nothing, so the walk comes back short
   * rather than clean over the remainder (issue #215).
   */
  it('discloses what it read, and refuses a walk that came back short', () => {
    const record = permissionLabelReadSize(walk);
    const refusal = readSizeRefusal(record);
    expect(
      refusal === null ? null : `${refusal.kind}: ${refusal.message}`,
      'the label sweep may not report on a population it did not read',
    ).toBeNull();
    // eslint-disable-next-line no-console -- the disclosure is the point (issue #244).
    console.log(readSizeLine(record));
  });

  it('every code is labelled by its owner, or by the legacy block, in every language', () => {
    const missing = findings
      .filter((f) => f.kind === 'missing-label' || f.kind === 'split-label')
      .map((f) => `${f.kind} ${f.code} [${f.module}] ${f.language ?? ''}: ${f.detail}`);
    expect(
      missing,
      `a code with no label falls back to the manifest \`label\`, which is English-only ` +
        `however many languages ship`,
    ).toEqual([]);
  });

  it('no module labels a code it does not own, and the shared bundle labels no dropped code', () => {
    const foreign = findings
      .filter((f) => f.kind === 'foreign-label' || f.kind === 'orphan-legacy-label')
      .map((f) => `${f.kind} ${f.code} [${f.module}]: ${f.detail}`);
    expect(foreign).toEqual([]);
  });

  it('the legacy block records exactly what is left in the shared bundle', () => {
    const drift = compareToLegacyBlock(counts, LEGACY_PERMISSION_LABELS);
    expect(
      drift.unrecorded.map((d) => `${d.owner}: ${d.actual} labels, block records ${d.declared}`),
      `a permission label was added to \`${LEGACY_LABEL_MODULE_ID}\`'s bundle instead of the ` +
        `owning module's own — put it in packages/modules/<owner>/i18n/{en,pl}.json. Do not ` +
        `raise a number in LEGACY_PERMISSION_LABELS to make this pass.`,
    ).toEqual([]);
    expect(
      drift.stale.map((d) => `${d.owner}: ${d.actual} labels, block still records ${d.declared}`),
      `labels moved out of the shared bundle and LEGACY_PERMISSION_LABELS still claims them — ` +
        `lower the number, or delete the entry when the owner has drained`,
    ).toEqual([]);
  });
});

/**
 * What a permission code needs beside itself — D-175, feature 080 T057.
 *
 * `ModulePermissionDeclaration.requires` is advisory: it names the codes a role
 * holding this one needs before the surface it opens is whole, the role editor
 * renders the shortfall with a one-click add, and nothing refuses a grant. The
 * machine owns exactly one half of it — that a requirement names a code the
 * platform's **vocabulary** holds — and this is where that half is answered.
 *
 * It lives in this file rather than in a `check-*` script of its own for the
 * reason the label sweep above does: the inventory is already the instrument
 * that reads every manifest code and every gate, and two derivations of one
 * population are two answers waiting to disagree. The rule and its red proofs
 * are `test/helpers/permission-dependencies.ts` and
 * `test/unit/admin_roles/permission-dependencies.test.ts`.
 *
 * **It is deliberately not wired into D-173's `foreign-gate` sweep**, which
 * D-175 proposed. That sweep derives its edges from the gates and the manifests
 * and needs nothing declared; its `declared-owner` verdict is ledgerable debt
 * and never a pass, because a declaration does not un-strand a screen. Letting
 * a `requires` entry answer it would license exactly the defect !956 closed.
 */
describe('permission dependencies (D-175)', () => {
  const service = new PermissionCatalogueService({ registryEntries: RESOLVED_MANIFESTS });
  const input: PermissionDependencyInput = {
    requirements: service.listRequirementsByCode(),
    known: new Set(service.listKnownCodes()),
    owners: service.listOwnersByCode(),
  };
  const declaring = RESOLVED_MANIFESTS.filter(
    (entry) => (entry.manifest.permissions?.length ?? 0) > 0,
  );
  const merged = new Set<string>();
  for (const owners of input.owners.values()) for (const owner of owners) merged.add(owner);

  it('discloses what it read, and refuses a merge that came back short', () => {
    const refusal = permissionDependencyRefusal(input);
    expect(refusal, 'the requirement sweep read nothing it could judge').toBeNull();
    const record = permissionDependencyReadSize({
      declaringManifests: declaring.length,
      mergedManifests: declaring.filter((entry) => merged.has(entry.manifest.id)).length,
      requirements: [...input.requirements.values()].reduce((n, list) => n + list.length, 0),
    });
    const short = readSizeRefusal(record);
    expect(
      short === null ? null : `${short.kind}: ${short.message}`,
      'the requirement sweep may not report on a population it did not read',
    ).toBeNull();
    // eslint-disable-next-line no-console -- the disclosure is the point (issue #244).
    console.log(readSizeLine(record));
  });

  it('every declared requirement names a code the platform knows', () => {
    const defects = findPermissionDependencyDefects(input)
      .filter((finding) => finding.kind === 'unknown-requirement')
      .map(
        (finding) =>
          `'${finding.code}' (${finding.owners.join('/')}) requires '${finding.requirement}', ` +
          'which no manifest and no catalogue row declares',
      );
    expect(
      defects,
      'a `requires` entry naming a code nothing declares advises an operator to ' +
        'grant something that does not exist — the vocabulary is `listKnownCodes()`, ' +
        'so a code whose owner is merely switched off is not this finding',
    ).toEqual([]);
  });

  it('no code requires itself', () => {
    const defects = findPermissionDependencyDefects(input)
      .filter((finding) => finding.kind === 'self-requirement')
      .map((finding) => `'${finding.code}' (${finding.owners.join('/')})`);
    expect(defects, 'holding the code satisfies it, so the entry advises nothing').toEqual([]);
  });
});

/**
 * Every permission code a demo role carries is one the platform knows
 * (issue #180).
 *
 * The demo seed writes its roles straight onto the entity, so nothing validates
 * the list on the way in — and `PUT /admin/admin-roles/:code` validates every
 * code on the way back. A demo role holding a code no manifest and no catalogue
 * row declares is therefore created without complaint and can never be saved
 * again: the role editor sends the stored codes back, the route answers
 * `400 Unknown permission(s)`, and the unknown code has no checkbox to un-tick.
 * A seed is neither a gate nor a manifest, so none of the sweeps above sees it.
 *
 * It lives in this file for the reason the two sweeps above do: the vocabulary
 * is the one that route validates against — `listKnownCodes()` over the
 * composed manifests — and a second derivation of it would be free to pass a
 * list the route refuses. It is the *known* set and not the grantable one, so
 * a code whose owning module is merely switched off is not this finding.
 */
describe('demo admin roles hold only known permission codes (issue #180)', () => {
  const known = new Set(
    new PermissionCatalogueService({ registryEntries: RESOLVED_MANIFESTS }).listKnownCodes(),
  );

  it('reads a vocabulary and at least one role with named codes', () => {
    // A green over an empty vocabulary or an all-wildcard role list would be
    // a green about nothing.
    expect(known.size).toBeGreaterThan(0);
    expect(
      DEMO_ADMIN_ROLES.some((role) => role.permissions.some((code) => code !== '*')),
    ).toBe(true);
  });

  it('every code is declared by a module manifest or the core catalogue', () => {
    const unknown = DEMO_ADMIN_ROLES.flatMap((role) =>
      role.permissions
        // `*` is the wildcard the role service collapses before it validates.
        .filter((code) => code !== '*' && !known.has(code))
        .map((code) => `${role.code}: '${code}'`),
    );
    expect(
      unknown,
      'a demo role carrying a code nothing declares cannot be saved from the role editor',
    ).toEqual([]);
  });
});

/**
 * The **buyer** vocabulary — organization permissions (`specs/170-organization-roles/`,
 * FR-020, FR-021, FR-022; `contracts/organization-permissions-manifest.md` §4).
 *
 * A second vocabulary, asked the questions the operator half above answers for
 * its own: is every code a guard or a service names declared, is every declared
 * code enforced (grantable ⇒ enforced), is it declared by the module whose
 * namespace it carries, is it never also an operator code, and is it labelled in
 * every shipped language. It lives in this file rather than in a `check-*`
 * script on `module-admin-surfaces.md` item 6's reasoning: this is already the
 * instrument that answers "declared, enforced and labelled", and a second one
 * would be a second derivation of the same population.
 *
 * Two independent authors: the generated manifest index says what is
 * declared; the source walk says what is checked. The rules and the walk are
 * `test/helpers/organization-permissions.ts`.
 *
 * WP-01 lands the instrument over an **empty** population — no module declares
 * a code yet — so the sweeps below are green by being vacuous on the real tree,
 * which is why every finding kind is also proven red on a synthetic fixture.
 */
describe('[organization-permissions] organization permission inventory (feature 170)', () => {
  const walk = walkOrganizationPermissionDeclarations(RESOLVED_MANIFESTS);
  const scan = scanOrganizationPermissionSites(SCAN_ROOTS);
  const operatorCodes = new Set(
    new PermissionCatalogueService({ registryEntries: RESOLVED_MANIFESTS }).listKnownCodes(),
  );
  const real: OrganizationPermissionInventoryInput = {
    declarations: walk.declarations,
    operatorCodes,
    sites: scan.sites,
    bundles: walk.bundles,
    languages: SUPPORTED_LANGUAGES,
  };

  it('discloses what it read, and refuses a walk that came back short', () => {
    const record = organizationPermissionReadSize(walk, scan);
    const refusal = readSizeRefusal(record);
    expect(
      refusal === null ? null : `${refusal.kind}: ${refusal.message}`,
      'the organization-permission sweep may not report on a population it did not read',
    ).toBeNull();
    // The walk opened the whole gate population, not a residue of it: the
    // operator scan above reads the same roots, so the two counts agree.
    expect(scan.files).toBeGreaterThan(0);
    // eslint-disable-next-line no-console -- the disclosure is the point (issue #244).
    console.log(readSizeLine(record));
  });

  it('the real population has no finding', () => {
    const findings = findOrganizationPermissionDefects(real).map(
      (f) => `${f.kind} ${f.code}${f.module ? ` [${f.module}]` : ''}${f.file ? ` (${f.file})` : ''}: ${f.detail}`,
    );
    expect(
      findings,
      'an organization permission must be declared by its own module, never be an operator code, be named ' +
        'by a guard or a service call, and be labelled in every shipped language',
    ).toEqual([]);
  });

  /**
   * Red proofs. Each fixture is the real tree's shape with exactly one defect,
   * so a finding that fires on it is the defect and nothing else.
   */
  describe('refuses each defect on a synthetic population', () => {
    const labelled = (module: string, codes: readonly string[], languages: readonly string[] = ['en', 'pl']) =>
      new Map([
        [
          module,
          new Map(
            languages.map((language) => [
              language,
              new Set(codes.flatMap((code) => [`organizationPermissions.${code}.label`, `organizationPermissions.${code}.description`])),
            ]),
          ),
        ],
      ]);
    const guarded = (code: string) =>
      scanOrganizationPermissionSource(
        `preHandler: [requireCustomer, organizationPermissionPreHandler(() => permissions, '${code}')]`,
        'fixture/routes.ts',
      );
    const clean: OrganizationPermissionInventoryInput = {
      declarations: [{ moduleId: 'fixture_carts', code: 'fixture_carts.create' }],
      operatorCodes: new Set(['fixture_carts:read']),
      sites: guarded('fixture_carts.create'),
      bundles: labelled('fixture_carts', ['fixture_carts.create']),
      languages: ['en', 'pl'],
    };
    const kinds = (input: OrganizationPermissionInventoryInput): OrganizationPermissionFindingKind[] =>
      [...new Set(findOrganizationPermissionDefects(input).map((f) => f.kind))].sort();

    it('the clean fixture has no finding — so every red below is its own defect', () => {
      expect(findOrganizationPermissionDefects(clean)).toEqual([]);
    });

    it('cross-vocabulary: a string declared as both an operator and an organization code', () => {
      expect(kinds({ ...clean, operatorCodes: new Set(['fixture_carts.create']) })).toEqual(['cross-vocabulary']);
    });

    it('foreign-declarer: an organization code whose prefix is not its declaring module', () => {
      expect(
        kinds({
          ...clean,
          declarations: [{ moduleId: 'fixture_orders', code: 'fixture_carts.create' }],
          bundles: labelled('fixture_orders', ['fixture_carts.create']),
        }),
      ).toEqual(['foreign-declarer']);
    });

    it('undeclared-check: a guard naming a code no manifest declares', () => {
      expect(
        kinds({ ...clean, sites: [...clean.sites, ...guarded('fixture_carts.approve')] }),
      ).toEqual(['undeclared-check']);
    });

    it('undeclared-check: a service call naming one, through can, assert and rolesHolding', () => {
      for (const call of [
        `await permissions.can(subject, 'fixture_carts.approve')`,
        `await this.organizationPermissions().assert(subject, 'fixture_carts.approve', { language })`,
        `const roles = await permissions.rolesHolding(organizationId, 'fixture_carts.approve')`,
      ]) {
        const sites = scanOrganizationPermissionSource(
          `import type { OrganizationPermissionPort } from '@endora-commerce/contracts';\n${call};`,
          'fixture/service.ts',
        );
        expect(kinds({ ...clean, sites: [...clean.sites, ...sites] }), call).toEqual(['undeclared-check']);
      }
    });

    it('unchecked-declaration: a declared code no guard or service call names', () => {
      expect(kinds({ ...clean, sites: [] })).toEqual(['unchecked-declaration']);
    });

    it('missing-label: a code without its label or description in the reference language', () => {
      const bundles = labelled('fixture_carts', ['fixture_carts.create']);
      for (const language of ['en', 'pl']) {
        const keys = new Set(bundles.get('fixture_carts')!.get(language)!);
        keys.delete('organizationPermissions.fixture_carts.create.description');
        bundles.get('fixture_carts')!.set(language, keys);
      }
      expect(kinds({ ...clean, bundles })).toEqual(['missing-label']);
      expect(kinds({ ...clean, bundles: new Map() })).toEqual(['missing-label']);
    });

    it('split-label: a code labelled in one shipped language and not the other', () => {
      expect(kinds({ ...clean, bundles: labelled('fixture_carts', ['fixture_carts.create'], ['en']) })).toEqual([
        'split-label',
      ]);
    });

    it('an unresolvable code argument is a finding, never a silently dropped site', () => {
      const sites = scanOrganizationPermissionSource(
        `organizationPermissionPreHandler(() => permissions, codeFor(route))`,
        'fixture/routes.ts',
      );
      expect(sites.map((site) => site.resolution)).toEqual(['unresolved']);
      expect(kinds({ ...clean, sites: [...clean.sites, ...sites] })).toEqual(['unresolved-argument']);
    });

    it('reads a module-local constant, and a parameter forwarded by an implementation, as what they are', () => {
      const constant = scanOrganizationPermissionSource(
        `const CREATE = 'fixture_carts.create';\nconst CODES = { approve: 'fixture_carts.approve' } as const;\n` +
          `organizationPermissionPreHandler(() => permissions, CREATE);\n` +
          `organizationPermissionPreHandler(() => permissions, CODES.approve, { guests: 'pass' });`,
        'fixture/routes.ts',
      );
      expect(constant.map((site) => [site.resolution, site.codes])).toEqual([
        ['code', ['fixture_carts.create']],
        ['code', ['fixture_carts.approve']],
      ]);
      const forwarded = scanOrganizationPermissionSource(
        `import type { OrganizationPermissionPort } from '@endora-commerce/contracts';\n` +
          `async function assert(subject: Subject, code: string): Promise<void> {\n  if (!(await this.can(subject, code))) throw refusal(code);\n}`,
        'fixture/port.ts',
      );
      expect(forwarded.map((site) => site.resolution)).toEqual(['runtime-value']);
    });

    it('a comment quoting a guard is not a guard, and an unrelated `assert` is not a check', () => {
      expect(
        scanOrganizationPermissionSource(
          `// organizationPermissionPreHandler(() => permissions, 'fixture_carts.nothing')\n` +
            `/* permissions.can(subject, 'fixture_carts.nothing') */\nassert.equal(a, 'b');`,
          'fixture/other.ts',
        ),
      ).toEqual([]);
    });
  });
});
