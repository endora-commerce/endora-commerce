import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { defineModuleManifest, type ModuleManifest } from '@endora-commerce/contracts';
import { Setting } from '../settings/setting.entity.js';
import {
  activationDeclarationsFrom,
  resolveActivation,
  type ModuleActivationDeclaration,
} from './activation-resolver.js';

/**
 * Feature 073 — the operator-activation axis (research R-5).
 *
 * The resolver reads the declared activation Setting rows directly, over two
 * tiers only (`global_value ?? default_value`). The third tier — per-channel
 * `setting_values` — is deliberately not read: activation is platform-wide
 * (FR-009) and joining it would reintroduce channel dependence through the
 * back door.
 */

interface RecordedQuery {
  entity: unknown;
  where: unknown;
  options: unknown;
}

interface SettingRow {
  code: string;
  globalValue?: unknown;
  defaultValue: unknown;
}

function fakeEm(rows: readonly SettingRow[], recorded: RecordedQuery[]): EntityManager {
  return {
    find: async (entity: unknown, where: unknown, options?: unknown) => {
      recorded.push({ entity, where, options });
      const codes = (where as { code?: { $in?: string[] } }).code?.$in ?? [];
      return rows.filter((r) => codes.includes(r.code));
    },
  } as unknown as EntityManager;
}

function control(moduleId: string, settingCode: string, dflt: boolean): ModuleActivationDeclaration {
  return { moduleId, settingCode, default: dflt, nonDeactivatableReason: null };
}

describe('activationDeclarationsFrom', () => {
  const manifests: ModuleManifest[] = [
    defineModuleManifest({
      id: 'fixture_control',
      name: 'Controlled',
      version: '1.0.0',
      dependencies: [],
      activation: { settingCode: 'fixture_control.activation', default: true },
    }),
    defineModuleManifest({
      id: 'fixture_cascade',
      name: 'Cascade owner',
      version: '1.0.0',
      dependencies: [],
      activation: {
        settingCode: 'fixture_cascade.enabled',
        default: true,
        cascadeDependentsOnDeactivate: true,
      },
    }),
    defineModuleManifest({
      id: '_fixture_core',
      name: 'Core',
      version: '1.0.0',
      dependencies: [],
      activation: { nonDeactivatable: true, reason: 'The platform cannot boot without it.' },
    }),
    defineModuleManifest({
      id: 'fixture_undeclared',
      name: 'Unconverted',
      version: '1.0.0',
      dependencies: [],
    }),
  ];

  it('maps the settingCode form to a control declaration', () => {
    const decls = activationDeclarationsFrom(manifests);
    expect(decls.find((d) => d.moduleId === 'fixture_control')).toEqual({
      moduleId: 'fixture_control',
      settingCode: 'fixture_control.activation',
      default: true,
      nonDeactivatableReason: null,
      cascadeDependentsOnDeactivate: false,
    });
  });

  it('maps cascadeDependentsOnDeactivate when the module opts in', () => {
    const decls = activationDeclarationsFrom(manifests);
    expect(decls.find((d) => d.moduleId === 'fixture_cascade')).toEqual({
      moduleId: 'fixture_cascade',
      settingCode: 'fixture_cascade.enabled',
      default: true,
      nonDeactivatableReason: null,
      cascadeDependentsOnDeactivate: true,
    });
  });

  it('maps the nonDeactivatable form to a declaration with no setting code', () => {
    const decls = activationDeclarationsFrom(manifests);
    expect(decls.find((d) => d.moduleId === '_fixture_core')).toEqual({
      moduleId: '_fixture_core',
      settingCode: null,
      default: true,
      nonDeactivatableReason: 'The platform cannot boot without it.',
    });
  });

  it('omits a module that declares no activation at all', () => {
    const decls = activationDeclarationsFrom(manifests);
    expect(decls.map((d) => d.moduleId)).not.toContain('fixture_undeclared');
  });
});

describe('resolveActivation', () => {
  it('resolves global_value when the operator has chosen', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm(
      [{ code: 'a.activation', globalValue: false, defaultValue: true }],
      recorded,
    );
    const resolved = await resolveActivation(em, [control('a', 'a.activation', true)]);
    expect(resolved.get('a')).toBe(false);
  });

  it('falls back to default_value when there is no global override', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([{ code: 'a.activation', globalValue: null, defaultValue: true }], recorded);
    const resolved = await resolveActivation(em, [control('a', 'a.activation', false)]);
    expect(resolved.get('a')).toBe(true);
  });

  it('treats an undefined global_value as no override', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([{ code: 'a.activation', defaultValue: true }], recorded);
    const resolved = await resolveActivation(em, [control('a', 'a.activation', false)]);
    expect(resolved.get('a')).toBe(true);
  });

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['an object', { on: true }],
    ['an array', [true]],
  ])('resolves a non-boolean global_value (%s) to false', async (_label, value) => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([{ code: 'a.activation', globalValue: value, defaultValue: true }], recorded);
    const resolved = await resolveActivation(em, [control('a', 'a.activation', true)]);
    expect(resolved.get('a')).toBe(false);
  });

  it('resolves a non-boolean default_value to false when there is no override', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([{ code: 'a.activation', globalValue: null, defaultValue: 'yes' }], recorded);
    const resolved = await resolveActivation(em, [control('a', 'a.activation', true)]);
    expect(resolved.get('a')).toBe(false);
  });

  it('falls back to the manifest default when the row does not exist yet', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([], recorded);
    const resolved = await resolveActivation(em, [
      control('a', 'a.activation', true),
      control('b', 'b.activation', false),
    ]);
    expect(resolved.get('a')).toBe(true);
    expect(resolved.get('b')).toBe(false);
  });

  it('forces a nonDeactivatable module on without consulting any setting', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([], recorded);
    const resolved = await resolveActivation(em, [
      { moduleId: 'settings', settingCode: null, default: true, nonDeactivatableReason: 'Holds every control.' },
    ]);
    expect(resolved.get('settings')).toBe(true);
    expect(recorded).toHaveLength(0);
  });

  it('does not report a module that declared nothing', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([{ code: 'a.activation', globalValue: true, defaultValue: true }], recorded);
    const resolved = await resolveActivation(em, [control('a', 'a.activation', true)]);
    expect(resolved.has('unknown_module')).toBe(false);
  });

  it('issues exactly one query, against settings, keyed by an explicit code list', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([], recorded);
    await resolveActivation(em, [
      control('a', 'a.activation', true),
      control('b', 'b.enabled', true),
      { moduleId: 'c', settingCode: null, default: true, nonDeactivatableReason: 'Core.' },
    ]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.entity).toBe(Setting);
    expect(recorded[0]?.where).toEqual({ code: { $in: ['a.activation', 'b.enabled'] } });
  });

  it('never populates or joins the per-channel setting_values tier', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([], recorded);
    await resolveActivation(em, [control('a', 'a.activation', true)]);
    const options = recorded[0]?.options as { populate?: unknown } | undefined;
    expect(options?.populate).toBeUndefined();
    expect(JSON.stringify(recorded[0]?.where)).not.toContain('salesChannel');
    expect(JSON.stringify(recorded[0]?.where)).not.toContain('values');
  });

  it('issues no query at all when nothing declares a control', async () => {
    const recorded: RecordedQuery[] = [];
    const em = fakeEm([], recorded);
    const resolved = await resolveActivation(em, []);
    expect(recorded).toHaveLength(0);
    expect(resolved.size).toBe(0);
  });
});
