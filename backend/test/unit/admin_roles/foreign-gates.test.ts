import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';

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
    surface: 'enforcement',
  };
}

/** The same site, written in an Admin UI layer: it decides whether a control is shown. */
function control(moduleId: string | null, file: string, ...codes: string[]): EnforcedGateSite {
  return { ...gate(moduleId, file, ...codes), surface: 'admin-control' };
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
   * The any-of narrowing, and its two directions (2026-08-28).
   *
   * `requireAdminAny(['payment_methods:read', 'delivery_methods:read'])` in
   * miniature. The second code is foreign and its owner is switchable, so the
   * per-code reading calls it `undeclared-owner`; but the first member is the
   * enforcing module's **own** code, and no operator can make that
   * un-grantable, so the route is never stranded and the harm this sweep
   * measures cannot occur. It is a `pass` with a kind that says why, not a
   * finding that disappears.
   *
   * The negative is the half that matters: take the alternative away — the same
   * gate written as a plain `requireAdmin`, one code — and the same run reports
   * the same code as a violation. Nothing is ledgered and nothing is silenced.
   */
  it('passes an any-of member whose alternative the operator cannot withdraw', () => {
    const manifests = [
      manifest('payment_methods', {
        permissions: [{ code: 'payment_methods:read', label: 'View payment methods' }],
      }),
      manifest('delivery_methods', {
        permissions: [{ code: 'delivery_methods:read', label: 'View delivery methods' }],
      }),
    ];
    const anyOf = gate(
      'payment_methods',
      'modules/payment_methods/routes.ts',
      'payment_methods:read',
      'delivery_methods:read',
    );
    const found = classifyForeignGates(input([anyOf], manifests));
    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe('delivery_methods:read');
    expect(found[0]?.kind).toBe('sufficient-alternative');
    expect(found[0]?.verdict).toBe('pass');

    // Same code, same modules, no alternative on the site.
    const alone = gate(
      'payment_methods',
      'modules/payment_methods/routes.ts',
      'delivery_methods:read',
    );
    const withoutAlternative = classifyForeignGates(input([alone], manifests));
    expect(withoutAlternative).toHaveLength(1);
    expect(withoutAlternative[0]?.kind).toBe('undeclared-owner');
    expect(withoutAlternative[0]?.verdict).toBe('violation');
  });

  /**
   * Issue #458 — the same narrowing, reached from an Admin UI any-of the
   * scanner reads rather than a site the fixture builds. The `@@` document list
   * used to be gated as `groups.some((group) => hasPermission(group.code))`,
   * which the scanner could only call a `runtime-value`, so none of its codes
   * was judged. Written as `hasAnyPermission([...])`, every member is judged,
   * against every other.
   */
  it('judges the members of a scanned hasAnyPermission any-of as alternatives', () => {
    const root = mkdtempSync(join(tmpdir(), 'foreign-gates-any-of-'));
    try {
      mkdirSync(join(root, 'crm'), { recursive: true });
      writeFileSync(
        join(root, 'crm', 'references.ts'),
        `const ok = canWrite && hasAnyPermission(['orders:read', 'tasks:read']);`,
        'utf8',
      );
      const scanned = scanEnforcedPermissionGates([{ dir: join(root, 'crm'), moduleId: 'crm' }]);
      const found = classifyForeignGates(
        input(scanned.sites, [
          manifest('crm'),
          locked('orders', { permissions: [{ code: 'orders:read', label: 'View orders' }] }),
          manifest('tasks', { permissions: [{ code: 'tasks:read', label: 'View tasks' }] }),
        ]),
      );
      expect(found.map((finding) => [finding.code, finding.kind])).toEqual([
        ['orders:read', 'owner-locked'],
        ['tasks:read', 'sufficient-alternative'],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The alternative has to be one an operator cannot withdraw. Two switchable
   * foreign codes on one any-of strand the route exactly as one does, so the
   * narrowing must not reach them — otherwise every violation is escapable by
   * adding a second code to the array.
   */
  it('does not pass an any-of whose every member can be withdrawn', () => {
    const found = classifyForeignGates(
      input(
        [gate('shipments', 'modules/shipments/routes.ts', 'returns:read', 'invoices:read')],
        [
          manifest('shipments'),
          manifest('returns', {
            permissions: [{ code: 'returns:read', label: 'View returns' }],
          }),
          manifest('invoices', {
            permissions: [{ code: 'invoices:read', label: 'View invoices' }],
          }),
        ],
      ),
    );
    expect(found.map((finding) => finding.verdict)).toEqual(['violation', 'violation']);
  });

  /**
   * Issue #1105 — a foreign code that decides whether an Admin UI **control**
   * is shown (a button, a tile, a nav entry) is the off-state working, not a
   * stranded screen: when the owner is switched off the code leaves
   * `/admin-roles` and the control disappears with the capability it reaches
   * (Constitution XVII). It is reported, with a kind naming why, and passes.
   */
  it('passes a foreign code gating an Admin UI control, and says so', () => {
    const found = classifyForeignGates(
      input(
        [control('customers', 'modules/customers/src/admin/pages/CustomersList.tsx', 'mfa:reset')],
        [manifest('customers'), manifest('mfa', { permissions: [{ code: 'mfa:reset', label: 'Reset MFA' }] })],
      ),
    );
    expect(found.map((finding) => [finding.code, finding.kind, finding.verdict])).toEqual([
      ['mfa:reset', 'admin-ui-control', 'pass'],
    ]);
  });

  it('passes a control in a locked consumer or a host file too', () => {
    const found = classifyForeignGates(
      input(
        [
          control('price_lists', 'modules/price_lists/src/admin/Page.tsx', 'rfqs:handle'),
          control(null, 'admin-shell/src/components/AppShell.tsx', 'rfqs:handle'),
        ],
        [
          locked('price_lists'),
          manifest('quote_requests', { permissions: [{ code: 'rfqs:handle', label: 'Handle quote requests' }] }),
        ],
      ),
    );
    expect(found.map((finding) => finding.kind)).toEqual(['admin-ui-control', 'admin-ui-control']);
  });

  /** The same code on an enforcement site is still judged as D-173 judges it. */
  it('still judges the same foreign code on an enforcement site', () => {
    const found = findingsOfKind(
      [gate('customers', 'modules/customers/src/backend/routes.ts', 'mfa:reset')],
      [manifest('customers'), manifest('mfa', { permissions: [{ code: 'mfa:reset', label: 'Reset MFA' }] })],
      'undeclared-owner',
    );
    expect(found.map((finding) => finding.verdict)).toEqual(['violation']);
  });

  /** Read off a real component file, not built by the fixture. */
  it('classifies a scanned component-level hasPermission gate as a control', () => {
    const root = mkdtempSync(join(tmpdir(), 'foreign-gates-control-'));
    try {
      mkdirSync(join(root, 'customers', 'src', 'admin', 'pages'), { recursive: true });
      writeFileSync(
        join(root, 'customers', 'src', 'admin', 'pages', 'CustomersList.tsx'),
        `export const Reset = () => (hasPermission('mfa:reset') ? <Button /> : null);`,
        'utf8',
      );
      const scanned = scanEnforcedPermissionGates([{ dir: join(root, 'customers'), moduleId: 'customers' }]);
      const found = classifyForeignGates(
        input(scanned.sites, [
          manifest('customers'),
          manifest('mfa', { permissions: [{ code: 'mfa:reset', label: 'Reset MFA' }] }),
        ]),
      );
      expect(found.map((finding) => [finding.code, finding.kind])).toEqual([['mfa:reset', 'admin-ui-control']]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Issue #1106 — an admin-shell nav any-of is read as one host site, so its
   * members are judged as alternatives of one another exactly as a scanned
   * `hasAnyPermission` is; a shell UI check on a switchable module's code is a
   * control.
   */
  it('judges a scanned admin-shell nav any-of and a shell UI check', () => {
    const root = mkdtempSync(join(tmpdir(), 'foreign-gates-shell-'));
    try {
      mkdirSync(join(root, 'components'), { recursive: true });
      writeFileSync(
        join(root, 'components', 'AppShell.tsx'),
        [
          `const items = [{ to: '/x', requiredPermission: ['orders:read', 'tasks:read'], module: null }];`,
          `const mayUseAssistant = hasPermission('prompt_actions:use');`,
        ].join('\n'),
        'utf8',
      );
      const scanned = scanEnforcedPermissionGates([{ dir: root, moduleId: null, adminLayer: true }]);
      const found = classifyForeignGates(
        input(scanned.sites, [
          locked('orders', { permissions: [{ code: 'orders:read', label: 'View orders' }] }),
          manifest('tasks', { permissions: [{ code: 'tasks:read', label: 'View tasks' }] }),
          manifest('prompt_actions', { permissions: [{ code: 'prompt_actions:use', label: 'Use prompts' }] }),
        ]),
      );
      expect(found.map((finding) => [finding.consumer, finding.code, finding.kind])).toEqual([
        [null, 'orders:read', 'owner-locked'],
        [null, 'prompt_actions:use', 'admin-ui-control'],
        [null, 'tasks:read', 'sufficient-alternative'],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    scan: ReturnType<typeof scanEnforcedPermissionGates>;
  }> => {
    const manifests = await resolvedManifestEntries();
    const scan = scanEnforcedPermissionGates(await permissionScanRoots());
    const built: ForeignGateInput = {
      sites: scan.sites,
      manifests,
      owners: new PermissionCatalogueService({ registryEntries: manifests }).listOwnersByCode(),
    };
    return { input: built, findings: classifyForeignGates(built), scan };
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

  /**
   * Issue #458 — the two `@@` document-list gates are judged, not passed over
   * as runtime values: each is one site naming every group's code.
   */
  it('reads the @@ document-list any-ofs as codes it judges', async () => {
    const scan = scanEnforcedPermissionGates(await permissionScanRoots());
    const documentLists = scan.sites
      .filter((site) => /admin[\\/]lib[\\/]references\.ts$/.test(site.file))
      .filter((site) => site.codes.includes('orders:read'))
      .map((site) => [site.moduleId, site.resolution, [...site.codes].sort()]);
    expect(documentLists.sort()).toEqual([
      ['crm', 'code', ['orders:read', 'projects:read', 'rfqs:handle', 'tasks:read']],
      ['projects', 'code', ['crm:read', 'orders:read', 'rfqs:handle', 'tasks:read']],
    ]);
    const runtime = scan.runtimeValue
      .filter((site) => /admin[\\/]lib[\\/]references\.ts$/.test(site.file))
      .map((site) => `${site.file}: ${site.expression}`);
    expect(runtime).toEqual([]);
  });

  /** Issue #1106 — the shell is in the population, and its nav data is read. */
  it('reads the admin-shell nav any-of as one host-owned site', async () => {
    const { scan } = await findings;
    const commandHooks = scan.sites
      .filter((site) => /AppShell\.tsx$/.test(site.file))
      .filter((site) => site.codes.includes('platform.command_outbox.read'))
      .map((site) => [site.moduleId, site.surface, site.codes]);
    expect(commandHooks).toEqual([
      [null, 'admin-control', ['platform.modules.read', 'platform.command_outbox.read']],
    ]);
  });

  /**
   * Issue #1123 — a module's admin contributions are in the population too, and
   * `requiredPermission: [...CONSTANT]` resolves to the constant's members: one
   * any-of per declaration, a route an enforcement site and a nav entry a control.
   */
  it('reads module admin requiredPermission spreads as one any-of site each', async () => {
    const { scan } = await findings;
    const spreadSites = (moduleId: string, expression: string) =>
      scan.sites
        .filter((site) => site.moduleId === moduleId && /admin[\\/]index\.ts$/.test(site.file))
        .filter((site) => site.expression === expression)
        .map((site) => [site.surface, site.resolution, site.codes]);
    const importExport = [
      'catalog:read',
      'catalog:write',
      'customers:read',
      'inventory:read',
      'inventory:write',
      'orders:read',
    ];
    expect(spreadSites('import_export', '[...REQUIRED_PERMISSION]')).toEqual([
      ['enforcement', 'code', importExport],
      ['admin-control', 'code', importExport],
    ]);
    expect(spreadSites('organizations', '[...READ_PERMISSION]')).toEqual([
      ['enforcement', 'code', ['customers:read', 'customers:manage']],
      ['enforcement', 'code', ['customers:read', 'customers:manage']],
      ['admin-control', 'code', ['customers:read', 'customers:manage']],
    ]);
  });

  it('carries no ledger entry describing a finding that is gone', async () => {
    const { findings: found } = await findings;
    expect(staleForeignGateLedgerEntries(found)).toEqual([]);
  });

  it('reports only passes, and every one for a reason the manifests carry', async () => {
    const { findings: found } = await findings;
    const kinds = [...new Set(found.map((finding) => finding.kind))].sort();
    // `sufficient-alternative` joined on 2026-08-28 with the shared
    // `GET /admin/order-statuses` gate, whose any-of names `payment_methods`'
    // own read code beside `delivery_methods`'. Both kinds are passes and both
    // are derived from the manifests on every run.
    // `admin-ui-control` joined with issue #1105, when the walk started reading
    // component files: a foreign code there decides whether a control is shown.
    expect(kinds).toEqual(['admin-ui-control', 'owner-locked', 'sufficient-alternative']);
    // Non-vacuity of the live half: the population is real gates, not an empty
    // walk that agrees with everything.
    expect(found.length).toBeGreaterThan(0);
  });
});
