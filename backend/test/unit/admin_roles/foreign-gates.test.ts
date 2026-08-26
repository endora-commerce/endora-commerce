import { describe, expect, it } from 'vitest';
import { defineModuleManifest, type ModuleManifest } from '@endora-commerce/contracts';
import {
  classifyForeignGates,
  foreignGateRefusal,
  staleForeignGateLedgerEntries,
  FOREIGN_GATES_TO_DRAIN,
  type ForeignGateFinding,
  type ForeignGateInput,
  type ForeignGateKind,
} from '../../helpers/foreign-gates.js';
import { permissionScanRoots } from '../../helpers/permission-scan-roots.js';
import {
  scanEnforcedPermissionGates,
  type EnforcedGateSite,
} from '../../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import { PermissionCatalogueService } from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import { resolvedManifestEntries } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * D-173 — the `foreign-gate` sweep, red-first.
 *
 * The rule is in `test/helpers/foreign-gates.ts`; this file is the two things
 * that make it worth anything. One proof per verdict the sweep can reach —
 * four of them, because four of a signal's five answers can go blind behind the
 * fifth's red (issue #130) — and each enters where a real run enters: gate
 * sites and manifests in, findings out. In particular the **ownership** half is
 * driven rather than supplied: every fixture builds a real
 * `PermissionCatalogueService` over its fixture manifests and asks it
 * `listOwnersByCode()`, so the merge that decides what `/admin-roles` offers is
 * the merge the verdict rests on. A fixture handing the classifier a
 * pre-computed owner set would prove the last function in the chain and leave
 * the question the sweep exists for — *who keeps this code grantable?* —
 * unexercised.
 *
 * Then the live sweep, over this build's own gates and manifests.
 */

// --- fixtures ---------------------------------------------------------------

function manifest(
  id: string,
  extra: Partial<Parameters<typeof defineModuleManifest>[0]> = {},
): { manifest: ModuleManifest } {
  return {
    manifest: defineModuleManifest({
      id,
      name: id,
      version: '1.0.0',
      // `defineModuleManifest` reads it before Zod applies the default.
      dependencies: [],
      // A module with neither an activation control nor a lock is invalid
      // (`assertActivationRules`), so a fixture that means "switchable" says so.
      activation: { settingCode: `${id}.enabled`, default: true },
      ...extra,
    }),
  };
}

function locked(id: string, extra: Partial<Parameters<typeof defineModuleManifest>[0]> = {}) {
  return manifest(id, {
    activation: { nonDeactivatable: true, reason: `${id} is the fixture's floor.` },
    ...extra,
  });
}

function gate(moduleId: string | null, file: string, ...codes: string[]): EnforcedGateSite {
  return {
    file,
    moduleId,
    expression: codes.map((code) => `'${code}'`).join(', '),
    resolution: 'code',
    codes,
  };
}

/** Sites and manifests in; the owner map derived by the real merge. */
function input(
  sites: readonly EnforcedGateSite[],
  manifests: ReadonlyArray<{ manifest: ModuleManifest }>,
): ForeignGateInput {
  return {
    sites,
    manifests,
    owners: new PermissionCatalogueService({ registryEntries: manifests }).listOwnersByCode(),
  };
}

function findingsOfKind(
  sites: readonly EnforcedGateSite[],
  manifests: ReadonlyArray<{ manifest: ModuleManifest }>,
  kind: ForeignGateKind,
): ForeignGateFinding[] {
  return classifyForeignGates(input(sites, manifests)).filter((finding) => finding.kind === kind);
}

// --- one proof per verdict --------------------------------------------------

describe('foreign-gate sweep — the shapes it refuses', () => {
  /**
   * The four `customers` and `quote_requests` gates D-173 found, in miniature:
   * the owner has an activation control, the consumer does not, so the code
   * leaves `/admin-roles` while the routes keep enforcing it.
   */
  it('reports a switchable owner gating a module that cannot be switched off', () => {
    const found = findingsOfKind(
      [gate('price_lists', 'modules/price_lists/routes.ts', 'rfqs:handle')],
      [
        locked('price_lists'),
        manifest('quote_requests', {
          permissions: [{ code: 'rfqs:handle', label: 'Handle quote requests' }],
        }),
      ],
      'locked-consumer',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.verdict).toBe('violation');
    expect(found[0]?.owners).toEqual(['quote_requests']);
  });

  /**
   * The same edge between two switchable modules, undeclared. It is a milder
   * defect — the operator can switch the consumer off too — and still a
   * violation, because nothing in the manifests says the two are coupled and
   * nothing else in the tree can see it.
   */
  it('reports two switchable modules with the edge declared nowhere', () => {
    const found = findingsOfKind(
      [gate('webhooks', 'modules/webhooks/routes.ts', 'integrations:manage')],
      [
        manifest('webhooks'),
        manifest('api_keys', {
          permissions: [{ code: 'integrations:manage', label: 'Manage API keys' }],
        }),
      ],
      'undeclared-owner',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.verdict).toBe('violation');
  });

  /**
   * Declared, and therefore debt rather than a defect: the lifecycle can see
   * the coupling and an operator's confirmation dialog can render it. It is
   * ledgerable and never a pass — the screen can still be reached with the
   * owner off and the consumer on.
   */
  it('reports a declared edge between two switchable modules as ledgerable', () => {
    const found = findingsOfKind(
      [gate('webhooks', 'modules/webhooks/routes.ts', 'integrations:manage')],
      [
        manifest('webhooks', { dependencies: ['api_keys'] }),
        manifest('api_keys', {
          permissions: [{ code: 'integrations:manage', label: 'Manage API keys' }],
        }),
      ],
      'declared-owner',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.verdict).toBe('ledgerable');
  });

  /**
   * The pass, and it has to be proven for the same reason the violations do: a
   * sweep that answered `violation` here would report 18 findings on this tree
   * and be edited into silence. A locked owner's code cannot leave
   * `/admin-roles`, so the gate holds however the operator flips things.
   */
  it('passes a gate whose owner cannot be switched off', () => {
    const found = findingsOfKind(
      [gate('seo', 'modules/seo/routes.ts', 'catalog:write')],
      [
        manifest('seo'),
        locked('catalog', {
          permissions: [{ code: 'catalog:write', label: 'Edit catalog' }],
        }),
      ],
      'owner-locked',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.verdict).toBe('pass');
  });

  /**
   * The repair the other four gates took, proven as the sweep sees it. A second
   * declarer of an existing code is a second **owner** — issue #213's shape for
   * `integrations:manage` — so the code survives while either surface is on and
   * the gate stops being foreign at all. Without this the repair would look
   * like a comment.
   */
  it('drops a gate entirely once the consumer co-declares the code', () => {
    const sites = [gate('organizations', 'modules/organizations/routes.admin.ts', 'customers:manage')];
    const manifests = [
      locked('organizations'),
      manifest('customers', {
        permissions: [{ code: 'customers:manage', label: 'Manage customer organizations' }],
      }),
    ];
    expect(classifyForeignGates(input(sites, manifests))).toHaveLength(1);

    const repaired = [
      locked('organizations', {
        permissions: [{ code: 'customers:manage', label: 'Manage customer organizations' }],
      }),
      manifests[1] as { manifest: ModuleManifest },
    ];
    expect(classifyForeignGates(input(sites, repaired))).toEqual([]);
  });

  /**
   * A host-owned file owns no code and has no activation control, so a foreign
   * gate there is the locked-consumer case. There are none today; the proof is
   * what stops the first one arriving unseen, which is the whole reason the
   * `moduleId === null` branch exists rather than being skipped.
   */
  it('reports a host-owned gate on a switchable module’s code', () => {
    const found = findingsOfKind(
      [gate(null, 'http/admin-routes.ts', 'rfqs:handle')],
      [
        manifest('quote_requests', {
          permissions: [{ code: 'rfqs:handle', label: 'Handle quote requests' }],
        }),
      ],
      'locked-consumer',
    );
    expect(found).toHaveLength(1);
  });

  /** A gate on a code nobody owns belongs to the inventory's forward sweep. */
  it('leaves a code no module owns to the permission inventory', () => {
    expect(
      classifyForeignGates(
        input([gate('seo', 'modules/seo/routes.ts', 'nobody:owns-this')], [manifest('seo')]),
      ),
    ).toEqual([]);
  });

  /** The ledger's second direction: an entry describing no finding. */
  it('reports a ledger entry that describes no ledgerable finding', () => {
    expect(
      staleForeignGateLedgerEntries([], { 'modules/gone/routes.ts|some:code': 'drained' }),
    ).toEqual(['modules/gone/routes.ts|some:code']);
  });
});

// --- the vacuity refusals ---------------------------------------------------

describe('foreign-gate sweep — what it refuses to answer', () => {
  const site = gate('price_lists', 'modules/price_lists/routes.ts', 'rfqs:handle');
  const manifests = [
    locked('price_lists'),
    manifest('quote_requests', {
      permissions: [{ code: 'rfqs:handle', label: 'Handle quote requests' }],
    }),
  ];

  it('answers nothing when there is nothing to answer about', () => {
    expect(foreignGateRefusal(input([site], []))).toMatch(/no manifest/);
    expect(foreignGateRefusal({ ...input([site], manifests), owners: new Map() })).toMatch(
      /no permission code has an owner/,
    );
    expect(foreignGateRefusal(input([], manifests))).toMatch(/no enforcement site/);
    // A gate the scanner could not read is not a gate this sweep may judge.
    expect(
      foreignGateRefusal(
        input(
          [{ ...site, resolution: 'unresolved', codes: [] } satisfies EnforcedGateSite],
          manifests,
        ),
      ),
    ).toMatch(/no enforcement site/);
    // Without a lock, `locked-consumer` is unreachable and every violation
    // silently downgrades to `undeclared-owner` — a smaller answer, not an error.
    expect(foreignGateRefusal(input([site], [manifest('price_lists'), manifests[1]!]))).toMatch(
      /nonDeactivatable/,
    );
  });

  it('answers when it has read enough', () => {
    expect(foreignGateRefusal(input([site], manifests))).toBeNull();
  });
});

// --- the live sweep ---------------------------------------------------------

describe('foreign-gate sweep — this build', () => {
  const findings = (async (): Promise<{
    input: ForeignGateInput;
    findings: readonly ForeignGateFinding[];
  }> => {
    const manifests = await resolvedManifestEntries();
    const scan = scanEnforcedPermissionGates(await permissionScanRoots());
    const built: ForeignGateInput = {
      sites: scan.sites,
      manifests,
      owners: new PermissionCatalogueService({ registryEntries: manifests }).listOwnersByCode(),
    };
    return { input: built, findings: classifyForeignGates(built) };
  })();

  it('read a population worth reporting on', async () => {
    const { input: built } = await findings;
    expect(foreignGateRefusal(built), 'the sweep read nothing it could judge').toBeNull();
  });

  it('has no module enforcing a code only a switchable module keeps grantable', async () => {
    const { findings: found } = await findings;
    const violations = found
      .filter((finding) => finding.verdict === 'violation')
      .filter((finding) => !(finding.key in FOREIGN_GATES_TO_DRAIN))
      .map(
        (finding) =>
          `${finding.file} gates '${finding.code}', owned by ${finding.owners.join('/')} ` +
          `(${finding.kind})`,
      );
    expect(
      violations,
      'D-173 — either the consumer declares the code too, so it is owned by ' +
        'every module that enforces it (issue #213’s shape for ' +
        '`integrations:manage`), or the gate names a code the consumer already ' +
        'owns. Declaring the owner as a `dependencies` entry is the repair to ' +
        'reach for last: a locked consumer declaring a switchable owner makes ' +
        'the orchestrator refuse to switch that owner off at all.',
    ).toEqual([]);
  });

  it('carries no ledger entry describing a finding that is gone', async () => {
    const { findings: found } = await findings;
    expect(staleForeignGateLedgerEntries(found)).toEqual([]);
  });

  it('reports only passes, and every one for a reason the manifests carry', async () => {
    const { findings: found } = await findings;
    const kinds = new Set(found.map((finding) => finding.kind));
    expect([...kinds]).toEqual(['owner-locked']);
    // Non-vacuity of the live half: the population is real gates, not an empty
    // walk that agrees with everything.
    expect(found.length).toBeGreaterThan(0);
  });
});
