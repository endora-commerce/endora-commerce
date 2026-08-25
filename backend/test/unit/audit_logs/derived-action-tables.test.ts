import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KnownIconNameSchema,
  ModuleRecentActivitySchema,
  recentActivityVisibilitySettingCode,
  settingsManifestWithRecentActivity,
  type ModuleManifest,
} from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import {
  RecentActivityActionConflict,
  RecentActivityCatalog,
} from '../../../../packages/modules/audit_logs/src/backend/services/recent-activity-catalog.js';
import { buildRecentActivityResponseSchema } from '../../../../packages/modules/audit_logs/src/backend/routes.admin.recent-activity.js';

/**
 * The four host-owned action tables are derived — feature 080, T042j / D-163.1.
 *
 * D-163 found **four** hand-maintained tables behind the dashboard's Recent
 * Activity card, and the proof that they cannot be kept true was already in the
 * tree: `prompt_action.execute` sat in two of them and not in the other two.
 * This file is the retiring condition for the whole row. It asserts, in order:
 *
 *  1. every table is computed from the manifests, and they agree by construction;
 *  2. `prompt_action.execute` is in all four — the drift, repaired by the
 *     derivation rather than by a fifth hand-written entry;
 *  3. none of the source files has grown a hand-maintained table back.
 *
 * The admin's half of (3) lives in
 * `admin/test/modules/home/activity-render.test.ts`, because the file is that
 * app's.
 */

const CATALOG = new RecentActivityCatalog(REGISTERED_MANIFESTS);

const DECLARING = REGISTERED_MANIFESTS.filter((entry) => entry.recentActivity !== undefined);

describe('the recent-activity catalog is derived from the manifests', () => {
  it('is non-vacuous: core declares eligibility somewhere', () => {
    // Without this, every assertion below is true of an empty set — the exact
    // "a green result must not be able to mean not looking" failure.
    expect(DECLARING.length).toBeGreaterThan(0);
    expect(CATALOG.actions().length).toBeGreaterThan(0);
  });

  it('holds exactly the union of the declared entries, and nothing a host wrote', () => {
    const declared = DECLARING.flatMap((entry) =>
      entry.recentActivity!.entries.map((e) => e.action),
    ).sort();
    expect(CATALOG.actions()).toEqual(declared);
    expect(CATALOG.moduleIds()).toEqual(DECLARING.map((e) => e.manifest.id).sort());
  });

  it('attributes each token to the module that declared it, with its icon and verb key', () => {
    for (const entry of DECLARING) {
      for (const declaration of entry.recentActivity!.entries) {
        const descriptor = CATALOG.descriptorFor(declaration.action);
        expect(descriptor?.moduleId, declaration.action).toBe(entry.manifest.id);
        expect(descriptor?.icon).toBe(declaration.icon);
        expect(descriptor?.labelKey).toBe(declaration.labelKey);
        expect(KnownIconNameSchema.safeParse(declaration.icon).success).toBe(true);
      }
    }
  });

  it('refuses two modules claiming one token rather than picking a winner', () => {
    const shared = ModuleRecentActivitySchema.parse({
      entries: [{ action: 'thing.create', icon: 'Plus', labelKey: 'activity.verb.thing.create' }],
    });
    expect(
      () =>
        new RecentActivityCatalog([
          { manifest: { id: 'alpha', name: 'Alpha' }, recentActivity: shared },
          { manifest: { id: 'beta', name: 'Beta' }, recentActivity: shared },
        ]),
    ).toThrow(RecentActivityActionConflict);
  });

  it('answers `undefined` for a token nobody declares, rather than throwing', () => {
    // The behaviour `moduleForAction` got wrong: it threw, with a comment
    // calling the case unreachable "as long as the allowlist and the prefix
    // table stay aligned". They were not aligned.
    expect(CATALOG.descriptorFor('setting.update')).toBeUndefined();
  });
});

describe('the route response schema is derived from the same catalog', () => {
  const schema = buildRecentActivityResponseSchema(CATALOG);
  const item = schema.shape.data.element;

  it('accepts every declared token and module id', () => {
    for (const action of CATALOG.actions()) {
      expect(item.shape.action.safeParse(action).success, action).toBe(true);
    }
    for (const moduleId of CATALOG.moduleIds()) {
      expect(item.shape.module.safeParse(moduleId).success, moduleId).toBe(true);
    }
  });

  it('rejects a token nothing declares', () => {
    expect(item.shape.action.safeParse('setting.update').success).toBe(false);
  });

  it('describes the shape honestly for a composition that declares nothing', () => {
    // `z.enum([])` is not a schema, and a composition with no declaring module
    // is legitimate. The fallback must accept a string, not crash the build.
    const empty = buildRecentActivityResponseSchema(new RecentActivityCatalog([]));
    expect(empty.shape.data.element.shape.action.safeParse('anything.at_all').success).toBe(true);
  });
});

describe('prompt_action.execute is no longer drift (D-163)', () => {
  /**
   * Before this feature: present in the server allow-list
   * (`RECENT_ACTIVITY_ACTIONS`) and in `PREFIX_TO_MODULE`; absent from the
   * route's three-member `module` enum and from the admin's
   * `ACTIVITY_RENDERING`. So the server fetched the row, classified it
   * `prompt_actions`, emitted a `module` value its own response contract did
   * not list, and the card drew the unknown-verb fallback.
   *
   * There is one declaration now, so the four cannot disagree — which is why
   * this test asserts the same fact at each of the four derivation points
   * rather than at one.
   */
  const ACTION = 'prompt_action.execute';

  it('(1) reaches the query filter — it is in the catalog the `$in` is built from', () => {
    expect(CATALOG.actions()).toContain(ACTION);
  });

  it('(2) classifies to prompt_actions without a prefix table', () => {
    expect(CATALOG.descriptorFor(ACTION)?.moduleId).toBe('prompt_actions');
    expect(CATALOG.moduleIds()).toContain('prompt_actions');
  });

  it('(3) is in the route response schema, module value included', () => {
    const item = buildRecentActivityResponseSchema(CATALOG).shape.data.element;
    expect(item.shape.action.safeParse(ACTION).success).toBe(true);
    expect(item.shape.module.safeParse('prompt_actions').success).toBe(true);
  });

  it('(4) carries a renderable icon and a verb key in its own module namespace', () => {
    const descriptor = CATALOG.descriptorFor(ACTION);
    expect(KnownIconNameSchema.safeParse(descriptor?.icon).success).toBe(true);
    expect(descriptor?.labelKey).toBe('activity.verb.prompt_action.execute');
  });

  it("ships that verb key in prompt_actions' own en and pl bundles", () => {
    for (const language of ['en', 'pl'] as const) {
      const bundle = JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(
              `../../../src/modules/prompt_actions/i18n/${language}.json`,
              import.meta.url,
            ),
          ),
          'utf8',
        ),
      ) as Record<string, string>;
      expect(bundle['activity.verb.prompt_action.execute'], language).toBeTruthy();
    }
  });
});

describe('every declaring module ships its verb keys in both languages', () => {
  it.each(['en', 'pl'] as const)('%s', (language) => {
    const missing: string[] = [];
    for (const entry of DECLARING) {
      const bundlePath = fileURLToPath(
        new URL(
          `../../../src/modules/${entry.manifest.id}/i18n/${language}.json`,
          import.meta.url,
        ),
      );
      const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as Record<string, string>;
      for (const declaration of entry.recentActivity!.entries) {
        if (!bundle[declaration.labelKey]) {
          missing.push(`${entry.manifest.id}: ${declaration.labelKey}`);
        }
      }
    }
    expect(missing, 'a declared verb with no translation renders as its raw key').toEqual([]);
  });
});

describe('the operator axis is derived too', () => {
  it('gives every eligible module a visibility Setting, defaulting to visible', () => {
    for (const entry of CATALOG.eligibleModules()) {
      expect(entry.settingCode).toBe(recentActivityVisibilitySettingCode(entry.moduleId));
      expect(entry.settingCode.endsWith('.recent_activity_visible')).toBe(true);
    }
  });

  it('merges that Setting into the module settings manifest the platform reconciles', () => {
    for (const entry of DECLARING) {
      const merged = settingsManifestWithRecentActivity(entry.manifest, entry.recentActivity);
      const code = recentActivityVisibilitySettingCode(entry.manifest.id);
      const setting = merged?.settings.find((s) => s.code === code);
      expect(setting, entry.manifest.id).toBeDefined();
      expect(setting?.valueType).toBe('boolean');
      // D-163.1: the default is that a declared module's entries appear.
      expect(setting?.defaultValue).toBe(true);
      // Managed on /platform/modules, never a second door on generic Settings.
      expect(setting?.hidden).toBe(true);
    }
  });

  it('leaves a module that declares no eligibility exactly as it was', () => {
    const manifest = REGISTERED_MANIFESTS.find((e) => e.manifest.id === 'orders')!.manifest;
    expect(settingsManifestWithRecentActivity(manifest, undefined)).toBe(manifest.settings);
  });

  it('builds a settings manifest for an eligible module that declared none', () => {
    const manifest = {
      id: 'probe_module',
      name: 'Probe Module',
      version: '1.0.0',
      dependencies: [],
    } as unknown as ModuleManifest;
    const merged = settingsManifestWithRecentActivity(
      manifest,
      ModuleRecentActivitySchema.parse({
        entries: [{ action: 'probe.execute', icon: 'Boxes', labelKey: 'activity.verb.probe' }],
      }),
    );
    expect(merged?.moduleCode).toBe('probe_module');
    expect(merged?.groups).toHaveLength(1);
    expect(merged?.settings[0]?.code).toBe('probe_module.recent_activity_visible');
  });

  it('refuses a module id that cannot carry a setting code', () => {
    // A platform-internal id (`_lifecycle`) would produce `_lifecycle.…`, which
    // `settingCodeRe` rejects. Refused loudly rather than silently skipped.
    expect(() => recentActivityVisibilitySettingCode('_lifecycle')).toThrow(
      /not a valid setting code/,
    );
  });
});

/**
 * The retiring condition, backend half.
 *
 * **The predicate is derived, so it needs no allow-list and cannot go stale.**
 * A finding is a host file naming a string literal that some module *declares*
 * as a recent-activity action — which is precisely what all four retired tables
 * did, and precisely what a fifth would have to do. It leaves a permission code
 * (`platform.modules.activate`), a container name and an event name alone
 * without any of them being written down here: they are not tokens anybody
 * declares. Widen a module's declaration and this guard widens with it.
 *
 * The admin's half is `admin/test/modules/home/activity-render.test.ts`,
 * because that file belongs to that app.
 */
describe('the host-owned action tables stay retired', () => {
  // Repository-relative, because `audit_logs` is a package now
  // (`@endora-commerce/mod-audit-logs`) and these paths are read off disk rather
  // than imported: the guard is about the *source text* a host file holds, so it
  // has to name the file the package compiles, not the artefact it ships.
  const FILES = [
    'packages/modules/audit_logs/src/backend/services/recent-activity-catalog.ts',
    'packages/modules/audit_logs/src/backend/services/recent-activity-service.ts',
    'packages/modules/audit_logs/src/backend/services/recent-activity-visibility.ts',
    'packages/modules/audit_logs/src/backend/routes.admin.recent-activity.ts',
    'packages/modules/audit_logs/src/backend/commands/recent-activity-visibility.commands.ts',
    'packages/modules/audit_logs/src/backend/index.ts',
  ];
  const DECLARED = new Set(CATALOG.actions());

  it('is non-vacuous: there is a declared token for the guard to look for', () => {
    expect(DECLARED.size).toBeGreaterThan(0);
  });

  it.each(FILES)('%s names no module-declared action token', (relative) => {
    const source = readFileSync(
      fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)),
      'utf8',
    );
    // Comments explain, by name, what was retired.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const named = [...(code.match(/'[^'\n]+'|"[^"\n]+"/g) ?? [])]
      .map((literal) => literal.slice(1, -1))
      .filter((value) => DECLARED.has(value));
    expect(
      [...new Set(named)],
      'a host file naming a module-declared action token is one of the four hand-maintained ' +
        "tables coming back — put it in the owning module's `recentActivity` manifest export",
    ).toEqual([]);
  });

  it('has no `action-catalog.ts` to add a token to', () => {
    // The file that held tables (1) and (2) is gone, not emptied: an empty
    // array is an invitation, and this one carried a header arguing for
    // curation that a package author could never satisfy.
    expect(
      existsSync(
        fileURLToPath(
          new URL('../../../../packages/modules/audit_logs/src/backend/action-catalog.ts', import.meta.url),
        ),
      ),
    ).toBe(false);
  });
});
