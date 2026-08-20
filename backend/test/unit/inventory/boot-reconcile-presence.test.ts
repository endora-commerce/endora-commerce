import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { CountryReferenceRegistry } from '../../../src/modules/dictionaries/services/country-reference-registry.js';
import { AuditReferenceRegistry } from '../../../src/modules/audit_logs/services/audit-reference-registry.js';

/**
 * Issue #146 / D-68 — `inventory`'s warehouse/channel reconcile decides presence
 * before it works.
 *
 * `WarehouseChannelReconciler.run()` creates a `warehouse_channel_assignments`
 * row per sales channel. With the module switched off it ran at every boot, so a
 * module an operator believes is stopped kept writing its own tables. This hook
 * is *not* mixed — it does work and nothing else — so it is probed as it stands.
 *
 * The consequence, stated where the probe is: a sales channel created while
 * `inventory` is off gets its default warehouse assignment at the next boot
 * rather than at reactivation. The reconciler is idempotent and every read of
 * those rows is gated anyway, so that is acceptable; if it stops being
 * acceptable the repair is to drive the reconcile from the activation event, not
 * to un-probe the hook.
 *
 * The other two hooks in the same file must **not** be probed: they push the
 * module's email defaults and its assistant tools into registries their hosts
 * filter by contributor presence. Probing them would mean a module switched back
 * on at runtime contributes nothing until the next restart.
 */

const reconcilerRun = vi.fn(async () => undefined);

vi.mock('../../../src/modules/inventory/services/warehouse-channel-reconciler.js', () => ({
  WarehouseChannelReconciler: class {
    run = reconcilerRun;
  },
}));

// The plugin builds queues, workers and a Redis-backed cache; the boot hooks
// never touch it, so it is stubbed away rather than composed.
vi.mock('../../../src/modules/inventory/plugin.js', () => ({
  inventoryModule: () => ({ handle: {}, plugin: async () => undefined }),
}));

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

interface Composed {
  runBootHooks: () => Promise<void>;
  registeredEmailDefaults: string[];
  registeredPromptTools: string[];
  countryReferences: CountryReferenceRegistry;
  auditReferences: AuditReferenceRegistry;
}

async function composeInventory(): Promise<Composed> {
  const { registerModule } = await import('../../../src/modules/inventory/backend.js');
  const container = createRootContainer();
  const registeredEmailDefaults: string[] = [];
  const registeredPromptTools: string[] = [];
  const countryReferences = new CountryReferenceRegistry();
  // Presence-blind on purpose: this fixture asks whether the *contribution* ran,
  // and the registry's own skip policy is pinned in
  // `test/unit/audit_logs/audit-reference-registry.test.ts`.
  const auditReferences = new AuditReferenceRegistry(() => true);
  registerValues(container, {
    emFactory: (): EntityManager => ({}) as EntityManager,
    eventBus: new EventBus(),
    auditLogService: {},
    emailDefaultsPort: {
      register: (code: string) => registeredEmailDefaults.push(code),
    },
    promptActionToolRegistry: {
      register: (tool: { name?: string }) => registeredPromptTools.push(tool.name ?? '?'),
    },
    // `dictionaries` owns `countryReferenceRegistry` and is not composed here.
    // Its contribution belongs with the two above: a deactivated `inventory`
    // still owns warehouses carrying a country code, so `dictionaries` must
    // still refuse to delete one out from under them (feature 077, D-87).
    countryReferenceRegistry: countryReferences,
    // `audit_logs` owns `auditReferenceRegistry` and is not composed here. Its
    // contribution belongs with the three above: the registry's host filters by
    // contributor, so probing here would leave the dashboard unable to name a
    // warehouse until the next restart after a reactivation (feature 075, D-87).
    auditReferenceRegistry: auditReferences,
  });
  const composed = composeModules([{ id: 'inventory', version: '1.0.0', registerModule }], {
    container,
    eventBus: new EventBus(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return {
    runBootHooks: () => composed.runBootHooks(),
    registeredEmailDefaults,
    registeredPromptTools,
    countryReferences,
    auditReferences,
  };
}

describe('inventory boot reconcile is gated on effective presence', () => {
  beforeEach(() => {
    reconcilerRun.mockClear();
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  it('assigns no warehouse to any channel while the module is off', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['inventory'] });
    expect(effectiveState.isPresent('inventory'), 'the fixture did not switch the module off').toBe(
      false,
    );

    const { runBootHooks } = await composeInventory();
    await runBootHooks();

    expect(
      reconcilerRun,
      'a switched-off module wrote warehouse/channel assignments at boot',
    ).not.toHaveBeenCalled();
  });

  it('still contributes its email defaults and assistant tools while off', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['inventory'] });

    const {
      runBootHooks,
      registeredEmailDefaults,
      registeredPromptTools,
      countryReferences,
      auditReferences,
    } = await composeInventory();
    await runBootHooks();

    expect(
      registeredEmailDefaults,
      'a contribution hook was probed, so switching the module back on at runtime would ' +
        'contribute nothing until the next restart',
    ).toEqual(['low_stock_alert', 'availability_back_in_stock']);
    expect(registeredPromptTools.length).toBeGreaterThan(0);
    expect(
      countryReferences.owners(),
      'the warehouse country scanner was probed too, so an operator can now delete a ' +
        'country a deactivated warehouse still sits in',
    ).toContain('inventory');
    expect(
      auditReferences.owners(),
      'the audit label resolver was probed, so an operator switching the module back on ' +
        'would read raw warehouse ids on the dashboard until the next restart',
    ).toContain('inventory');
  });

  it('reconciles again once the module is back on', async () => {
    const { runBootHooks } = await composeInventory();
    await runBootHooks();

    expect(reconcilerRun).toHaveBeenCalledTimes(1);
  });
});
