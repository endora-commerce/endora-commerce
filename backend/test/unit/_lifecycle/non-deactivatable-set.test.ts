import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * The three-way classification of every shipped module — feature 074, Phase 1.
 *
 * This file was rewritten rather than adjusted. Its previous form admitted a
 * `nonDeactivatable` declaration on one of four grounds, two of which were
 * **another module's declaration reaching the target**: a transitive walk of
 * manifest `dependencies` from a criterion module, and ownership of a port a
 * criterion module resolves. Ruling 2 of feature 074 removes exactly that
 * authority — a dependent may warn an operator, never veto them — so both
 * grounds are gone and nothing computed from the dependency graph decides
 * membership here.
 *
 * What replaces them is the three-part product test (FR-001), applied to one
 * manifest without reading any other:
 *
 *  - **C1 reachability** — switched off, the platform can no longer
 *    authenticate an operator, resolve the tenant, or switch anything back on;
 *  - **C2 functional base** — its absence does not reduce the platform, it
 *    makes it a different product;
 *  - **C3 platform primitive** — it carries no independent business decision.
 *
 * The list below is therefore a **product ruling written down**, not a
 * derivation. The test's job is to prove that every member declares the lock in
 * its own manifest with its own reason, that nothing outside the list declares
 * it, and that the three categories partition the discovered manifest set —
 * so a 66th module fails here instead of slipping through into whichever
 * category its author forgot.
 */

/** Core — 25 modules, each declaring `nonDeactivatable` with its own reason. */
const CORE_MODULES = [
  '_i18n',
  '_lifecycle',
  'addresses',
  'admin_roles',
  'admin_users',
  'assets_library',
  'audit_logs',
  'auth',
  'carts',
  'catalog',
  'currencies',
  'custom_fields',
  'customer_accounts',
  'dictionaries',
  'email',
  'invoice_ledger',
  'languages',
  'orders',
  'organizations',
  'pim_connector',
  'price_lists',
  'sales_channels',
  'settings',
  'taxes',
  'transactional_emails',
] as const;

/**
 * Structurally unswitchable — 1 module. It owns exactly one surface, the
 * probes, and those are exempt from gating outright through `ctx.ungatedRoutes`,
 * so neither axis has a seam left to close. It gets a test rather than a third
 * schema arm (FR-015): declaring `nonDeactivatable` here would announce a
 * hazard the route exemption has already removed (FR-014).
 */
const STRUCTURALLY_UNSWITCHABLE = ['health_checks'] as const;

/** The three feature 073 Amendment A1 moved onto an operator control. */
const NEWLY_DEACTIVATABLE = ['admin_actions', 'delivery_methods', 'payment_methods'] as const;

/**
 * The five modules feature 074 gives a control they never had. Their default is
 * the whole reason they are named here: a module with no activation declaration
 * resolves as **activated** today, so `default: false` on a new control would
 * silently switch a working capability off in every existing deployment on
 * merge. All five take `default: true` (FR-012), including `prompt_actions`,
 * which supersedes D-44 §6's `default: false` (FR-012a).
 */
const NEW_CONTROLS = ['blog', 'credentials', 'mfa', 'product_feeds', 'prompt_actions'] as const;

const manifests = REGISTERED_MANIFESTS.map((entry) => entry.manifest);
const byId = new Map(manifests.map((m) => [m.id, m]));
const allIds = manifests.map((m) => m.id).sort();

function activationOf(id: string): unknown {
  const manifest = byId.get(id);
  expect(manifest, `no manifest is registered for "${id}"`).toBeDefined();
  return manifest!.activation;
}

const declaringIds = manifests
  .filter((m) => m.activation !== undefined && 'nonDeactivatable' in m.activation)
  .map((m) => m.id)
  .sort();

const controlIds = manifests
  .filter((m) => m.activation !== undefined && !('nonDeactivatable' in m.activation))
  .map((m) => m.id)
  .sort();

const undeclaredIds = manifests
  .filter((m) => m.activation === undefined)
  .map((m) => m.id)
  .sort();

describe('the classification partitions the discovered manifest set (FR-007, SC-002)', () => {
  it('assigns every discovered manifest to exactly one category', () => {
    // Asserted against the discovered set rather than a hard-coded total: a new
    // module has to be classified before this passes, which is the only way the
    // partition stays a decision instead of a snapshot.
    const classified = [
      ...CORE_MODULES,
      ...controlIds,
      ...STRUCTURALLY_UNSWITCHABLE,
    ].sort();
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified).toEqual(allIds);
  });

  it('operator-controlled count is the residual of the discovered set', () => {
    expect(CORE_MODULES).toHaveLength(25);
    expect(STRUCTURALLY_UNSWITCHABLE).toHaveLength(1);
    // Residual, not a snapshot: a module joining or leaving the control set
    // must not require a hand-edited total. The two lists above are product
    // rulings written down; this number is derived from them.
    expect(controlIds).toHaveLength(
      manifests.length - CORE_MODULES.length - STRUCTURALLY_UNSWITCHABLE.length,
    );
  });
});

describe('core — the lock is declared by its owner (FR-004, SC-003)', () => {
  it.each(CORE_MODULES)('%s declares nonDeactivatable with its own reason', (id) => {
    const activation = activationOf(id) as { nonDeactivatable?: true; reason?: string };
    expect(activation, `${id} declares no activation block at all`).toBeDefined();
    expect(activation.nonDeactivatable, `${id} is core but declares a switchable control`).toBe(
      true,
    );
    expect(typeof activation.reason).toBe('string');
    expect(activation.reason!.trim().length).toBeGreaterThan(0);
  });

  it('nothing outside the core set declares the lock', () => {
    expect(declaringIds).toEqual([...CORE_MODULES].sort());
  });

  it.each(CORE_MODULES)('%s\'s reason does not lean on another module', (id) => {
    // The mechanical form of ruling 2, in the two shapes the tree actually
    // wrote. Six of the thirteen pre-074 reasons named another module in
    // backticks ("the non-deactivatable `organizations` resolves this module's
    // `addressService`"), and the phrases below are the vocabulary of the two
    // grounds the ruling deleted. A bare word like "email" or "orders" is not
    // matched: those are ordinary English in a sentence about mail or about
    // transactions, and matching them would push authors into worse prose
    // rather than into better grounds.
    const { reason } = activationOf(id) as { reason: string };
    const citedModules = allIds.filter(
      (other) => other !== id && reason.includes(`\`${other}\``),
    );
    expect(citedModules, `${id}'s reason cites ${citedModules.join(', ')}`).toEqual([]);
    expect(
      reason,
      `${id}'s reason restates a ground ruling 2 removed`,
    ).not.toMatch(/non-deactivatable|declares this module|fails? closed|closure|acknowledged/i);
  });
});

describe('operator-controlled — everything that is not core (FR-005)', () => {
  it.each(
    manifests
      .filter((m) => !(CORE_MODULES as readonly string[]).includes(m.id))
      .filter((m) => !(STRUCTURALLY_UNSWITCHABLE as readonly string[]).includes(m.id))
      .map((m) => m.id)
      .sort(),
  )('%s declares a settings-backed control with a stated default', (id) => {
    const activation = activationOf(id) as { settingCode?: string; default?: boolean };
    expect(activation, `${id} declares no activation block at all`).toBeDefined();
    expect(typeof activation.settingCode).toBe('string');
    expect(typeof activation.default).toBe('boolean');
    // The control belongs to the declaring module — the same rule
    // `defineModuleManifest` enforces, asserted here against the shipped set.
    expect(
      activation.settingCode === id || activation.settingCode!.startsWith(`${id}.`),
    ).toBe(true);
  });

  it.each(NEW_CONTROLS)('%s gains a control that defaults to on (FR-012, FR-012a)', (id) => {
    const activation = activationOf(id) as { settingCode?: string; default?: boolean };
    expect(activation).toBeDefined();
    expect(activation.default, `${id} would change state on merge`).toBe(true);
  });

  it.each(NEWLY_DEACTIVATABLE)('%s keeps the control Amendment A1 gave it', (id) => {
    const activation = activationOf(id);
    expect(activation, `${id} has no activation declaration`).toBeDefined();
    expect(activation, `${id} declares itself non-deactivatable`).not.toHaveProperty(
      'nonDeactivatable',
    );
    expect(activation).toHaveProperty('settingCode', `${id}.enabled`);
    expect(activation).toHaveProperty('default', true);
  });
});

describe('structurally unswitchable — one module, on purpose (FR-013, FR-014)', () => {
  it('health_checks is the only manifest with no activation block', () => {
    // The reason is at the assertion, not in a backlog: this module owns
    // exactly one surface — the liveness and readiness probes — and
    // `ctx.ungatedRoutes` exempts it from gating outright, so an orchestrator
    // that reports the module disabled still gets an answer from /health.
    // There is no seam either presence axis could close, which is a different
    // statement from "we have not got round to it" and is what retires the
    // "No switch yet" label.
    expect(undeclaredIds).toEqual([...STRUCTURALLY_UNSWITCHABLE]);
  });

  it('and it does not declare nonDeactivatable either', () => {
    // Declaring it would announce a hazard the route exemption has removed,
    // and would take `module:disable health_checks` away from a deployment
    // operator for nothing.
    expect(declaringIds).not.toContain('health_checks');
  });
});

describe('the criterion this file applies (FR-002, FR-062)', () => {
  it('imports no dependency-graph helper', () => {
    // FR-062, in its mechanical form. A test that needs the graph to decide is
    // a test applying the criterion ruling 2 removed, so the constraint is
    // asserted over this file's own import list rather than left to review.
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const imported = [...source.matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map(
      (match) => match[1]!,
    );
    expect(imported.length).toBeGreaterThan(0);
    expect(
      imported.filter((path) => /check-port-dependencies|gating-graph/.test(path)),
    ).toEqual([]);
  });
});
