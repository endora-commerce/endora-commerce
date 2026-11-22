import { describe, expect, it } from 'vitest';
import type { ModuleListItem } from '@endora-commerce/contracts';
import { localizeModuleListItem, MODULE_TEXT_KEYS } from './module-text.js';

/**
 * Issue #1809 — Platform → Modules named and described every module in
 * English, and gave its "why it cannot be switched off" reason in English, in
 * a Polish admin. The three are platform prose from the module's manifest; the
 * list is an HTTP response whose reader's language the backend resolves, so the
 * backend translates them from the module's own bundle
 * (`specs/conventions/module-i18n.md`, case 1) and keeps the manifest's English
 * whenever the bundle has nothing to say.
 */
const carts: ModuleListItem = {
  id: 'carts',
  name: 'Carts',
  description: 'Shopping cart aggregation, pricing, lifecycle, and approval gate.',
  nonDeactivatableReason: 'The basket every ordering path assembles.',
  version: { registered: '1.0.0', onDisk: '1.0.0' },
  state: 'installed',
  dependencies: [],
  flags: [],
  installedAt: null,
  lastStateChangeAt: null,
};

const PL: Record<string, string> = {
  'carts.module.name': 'Koszyki',
  'carts.module.description': 'Koszyk: zbieranie pozycji, ceny, cykl życia i akceptacja.',
  'carts.module.nonDeactivatableReason': 'Koszyk, przez który przechodzi każda ścieżka zamawiania.',
};
const translate = async (moduleId: string, key: string): Promise<string> => PL[`${moduleId}.${key}`] ?? `${moduleId}.${key}`;

describe('localizeModuleListItem', () => {
  it('names, describes and explains a module in Polish for a Polish reader', async () => {
    const out = await localizeModuleListItem(carts, 'pl', translate);
    expect(out.name).toBe('Koszyki');
    expect(out.description).toBe('Koszyk: zbieranie pozycji, ceny, cykl życia i akceptacja.');
    expect(out.nonDeactivatableReason).toBe('Koszyk, przez który przechodzi każda ścieżka zamawiania.');
    expect(out.id).toBe('carts');
  });

  it('answers the manifest English for an English reader without asking', async () => {
    const never = async (): Promise<string> => {
      throw new Error('not asked');
    };
    expect(await localizeModuleListItem(carts, 'en', never)).toEqual(carts);
  });

  it('keeps the manifest English for a key the bundle lacks, a refusing resolver and no resolver', async () => {
    const other = { ...carts, id: 'webhooks', name: 'Webhooks' };
    expect((await localizeModuleListItem(other, 'pl', translate)).name).toBe('Webhooks');
    const refusing = async (): Promise<string> => {
      throw new Error('_i18n is off');
    };
    expect(await localizeModuleListItem(carts, 'pl', refusing)).toEqual(carts);
    expect(await localizeModuleListItem(carts, 'pl', undefined)).toEqual(carts);
  });

  it('leaves a missing description and an absent reason alone', async () => {
    const orphan = { ...carts, id: 'gone', name: 'gone', description: null, nonDeactivatableReason: null };
    expect(await localizeModuleListItem(orphan, 'pl', translate)).toEqual(orphan);
  });

  it('names its keys once, for the bundles that answer them', () => {
    expect(MODULE_TEXT_KEYS).toEqual({
      name: 'module.name',
      description: 'module.description',
      nonDeactivatableReason: 'module.nonDeactivatableReason',
    });
  });
});
