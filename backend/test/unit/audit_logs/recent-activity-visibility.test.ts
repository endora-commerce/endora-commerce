import { describe, expect, it, vi } from 'vitest';
import {
  ModuleRecentActivitySchema,
  recentActivityVisibilitySettingCode,
} from '@endora-commerce/contracts';
import type { SettingsReadPort, SettingsReadResult } from '../../../src/kernel/ports/settings.js';
import {
  RecentActivityCatalog,
  type RecentActivityDeclarationSource,
} from '../../../../packages/modules/audit_logs/src/backend/services/recent-activity-catalog.js';
import { RecentActivityVisibility } from '../../../../packages/modules/audit_logs/src/backend/services/recent-activity-visibility.js';

/**
 * The operator axis of D-163.1 — feature 080, T042j.
 *
 * A module declares eligibility; the operator decides whether it appears; the
 * default is that it does. What is asserted here is that the switch works
 * **both ways**, that the default is visible, and that "every module hidden"
 * does not degrade into "no filter", which would put the entire audit trail on
 * the home dashboard.
 */

const CATALOG_SOURCES: RecentActivityDeclarationSource[] = [
  {
    manifest: { id: 'catalog', name: 'Catalog' },
    recentActivity: ModuleRecentActivitySchema.parse({
      entries: [
        { action: 'product.create', icon: 'Plus', labelKey: 'activity.verb.product.create' },
        { action: 'product.update', icon: 'Edit', labelKey: 'activity.verb.product.update' },
      ],
    }),
  },
  {
    manifest: { id: 'inventory', name: 'Inventory' },
    recentActivity: ModuleRecentActivitySchema.parse({
      entries: [
        { action: 'warehouse.create', icon: 'Truck', labelKey: 'activity.verb.warehouse.create' },
      ],
    }),
  },
  // Declares nothing: it owns no visibility Setting and contributes no token.
  { manifest: { id: 'orders', name: 'Orders' } },
];

const CATALOG_CODE = recentActivityVisibilitySettingCode('catalog');
const INVENTORY_CODE = recentActivityVisibilitySettingCode('inventory');

function settingsReturning(values: Record<string, SettingsReadResult<unknown>>): SettingsReadPort {
  return {
    get: vi.fn(async () => {
      throw new Error('RecentActivityVisibility must batch, never read one code at a time');
    }),
    getMany: vi.fn(async (codes: string[]) => {
      const out = new Map<string, SettingsReadResult<unknown>>();
      for (const code of codes) {
        const value = values[code];
        if (value) out.set(code, value);
      }
      return out;
    }),
  } as unknown as SettingsReadPort;
}

const visible = (value: boolean): SettingsReadResult<unknown> => ({ ok: true, value });

describe('RecentActivityVisibility', () => {
  const catalog = new RecentActivityCatalog(CATALOG_SOURCES);

  it('lists exactly the eligible modules, with their operator-facing names', async () => {
    const rows = await new RecentActivityVisibility(catalog, settingsReturning({})).list();
    expect(rows.map((r) => r.moduleId)).toEqual(['catalog', 'inventory']);
    expect(rows.map((r) => r.moduleName)).toEqual(['Catalog', 'Inventory']);
    // A module that declares no eligibility gets no control, because there is
    // nothing for the operator to decide about it.
    expect(rows.find((r) => r.moduleId === 'orders')).toBeUndefined();
  });

  it('defaults to visible when the operator has never chosen', async () => {
    const rows = await new RecentActivityVisibility(catalog, settingsReturning({})).list();
    expect(rows.every((r) => r.visible)).toBe(true);
  });

  it('reads a stored `false` and hides that module — and only that module', async () => {
    const service = new RecentActivityVisibility(
      catalog,
      settingsReturning({ [CATALOG_CODE]: visible(false) }),
    );
    expect(await service.list()).toEqual([
      { moduleId: 'catalog', moduleName: 'Catalog', visible: false },
      { moduleId: 'inventory', moduleName: 'Inventory', visible: true },
    ]);
    expect(await service.visibleActions()).toEqual(['warehouse.create']);
  });

  it('switches back on — the flip is reversible in both directions', async () => {
    const service = new RecentActivityVisibility(
      catalog,
      settingsReturning({ [CATALOG_CODE]: visible(true) }),
    );
    expect(await service.visibleActions()).toEqual([
      'product.create',
      'product.update',
      'warehouse.create',
    ]);
  });

  it('answers an empty token list when every eligible module is hidden', async () => {
    // The alternative — falling through to no filter — puts every audited write
    // on the home dashboard, which is the exact opposite of what the operator
    // asked for. `RecentActivityService` short-circuits on this.
    const service = new RecentActivityVisibility(
      catalog,
      settingsReturning({
        [CATALOG_CODE]: visible(false),
        [INVENTORY_CODE]: visible(false),
      }),
    );
    expect(await service.visibleActions()).toEqual([]);
  });

  it('treats a non-boolean stored value as visible rather than as a hidden module', async () => {
    // The row exists but carries something the schema refuses. The operator has
    // still not said "hide this", and the ruling's default is what a
    // non-answer resolves to.
    const service = new RecentActivityVisibility(
      catalog,
      settingsReturning({ [CATALOG_CODE]: { ok: true, value: 'nonsense' } }),
    );
    expect((await service.list()).find((r) => r.moduleId === 'catalog')?.visible).toBe(true);
  });

  it('treats an unregistered code as visible: the reconcile has not run yet', async () => {
    const service = new RecentActivityVisibility(
      catalog,
      settingsReturning({ [CATALOG_CODE]: { ok: false, error: 'not_registered' } }),
    );
    expect((await service.list()).find((r) => r.moduleId === 'catalog')?.visible).toBe(true);
  });

  it('reads platform-wide, never per sales channel (FR-009, Constitution XII)', async () => {
    const settings = settingsReturning({});
    await new RecentActivityVisibility(catalog, settings).list();
    expect(settings.getMany).toHaveBeenCalledWith([CATALOG_CODE, INVENTORY_CODE], null);
  });

  it('asks the settings store nothing when no module is eligible', async () => {
    const settings = settingsReturning({});
    const empty = new RecentActivityVisibility(new RecentActivityCatalog([]), settings);
    expect(await empty.list()).toEqual([]);
    expect(await empty.visibleActions()).toEqual([]);
    expect(settings.getMany).not.toHaveBeenCalled();
  });
});
