import {
  recentActivityVisibilitySettingCode,
  type KnownIconName,
  type ModuleManifest,
  type ModuleRecentActivity,
} from '@endora-commerce/contracts';

/**
 * The recent-activity catalog — feature 080, T042j / D-163.1.
 *
 * **This file is what replaced four hand-maintained tables**, and it is worth
 * saying which four, because their shapes were different and only one of them
 * looked like a list:
 *
 *  1. `action-catalog.ts`'s `RECENT_ACTIVITY_ACTIONS` — 23 tokens, the
 *     dashboard query's `$in`. A token missing from it was **silently absent**
 *     from the card rather than refused, which is the whole of D-163's finding:
 *     a package could never appear there.
 *  2. The same file's `PREFIX_TO_MODULE` plus `RecentActivityModule`, a **closed
 *     union of four core module ids**. A closed union is a list written down,
 *     and a package's id could not be in it.
 *  3. `routes.admin.recent-activity.ts`'s `module: z.enum([...])`, three members.
 *  4. The admin's `ACTIVITY_RENDERING`, 22 entries mapping a token to a
 *     lucide icon and an i18n key.
 *
 * All four are computed from one input now: the `recentActivity` export of each
 * composed module's `manifest.ts`. The **drift already standing inside core**
 * is repaired by that rather than by a fifth entry — `prompt_action.execute`
 * was in (1) and (2) and absent from (3) and (4), so a prompt-assistant row was
 * fetched, classified, and then rendered as an unknown verb against a response
 * schema that did not list the `module` value the server emitted.
 *
 * What this class does **not** decide is whether a declared module's rows
 * appear. That is the operator's axis (see {@link RecentActivityVisibility}),
 * read per request from the module's own Setting and defaulting to visible.
 * Neither axis is derivable from the other, which is Constitution XVII's shape
 * applied to a narrower object.
 */

/** The two properties of a resolved registry entry this derivation reads. */
export interface RecentActivityDeclarationSource {
  readonly manifest: Pick<ModuleManifest, 'id' | 'name'>;
  readonly recentActivity?: ModuleRecentActivity | undefined;
}

/** One declared action, with everything the card and the route need about it. */
export interface RecentActivityDescriptor {
  /** The `audit_log_entries.action` token. */
  readonly action: string;
  /** The module that declared it — what used to be `RecentActivityModule`. */
  readonly moduleId: string;
  /** Operator-facing module name, for the visibility screen. */
  readonly moduleName: string;
  readonly icon: KnownIconName;
  /** Relative to `moduleId`'s i18n namespace — the admin resolves it there. */
  readonly labelKey: string;
}

/** One eligible module, and the Setting that decides whether it is shown. */
export interface RecentActivityModuleEntry {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly settingCode: string;
  readonly actions: readonly string[];
}

/**
 * Two modules declaring one action token.
 *
 * Refused rather than resolved by declaration order, for the reason a package
 * claiming a taken module id is refused (D-155.7): the token decides which
 * module's visibility Setting governs a row and which namespace its verb is
 * looked up in, so picking a winner silently attributes one module's activity
 * to another, and an operator switching the loser off would change nothing.
 */
export class RecentActivityActionConflict extends Error {
  override readonly name = 'RecentActivityActionConflict';
}

export class RecentActivityCatalog {
  private readonly byAction: ReadonlyMap<string, RecentActivityDescriptor>;
  private readonly modules: readonly RecentActivityModuleEntry[];

  constructor(sources: ReadonlyArray<RecentActivityDeclarationSource>) {
    const byAction = new Map<string, RecentActivityDescriptor>();
    const modules: RecentActivityModuleEntry[] = [];
    for (const source of sources) {
      const declaration = source.recentActivity;
      if (!declaration) continue;
      const moduleId = source.manifest.id;
      const moduleName = source.manifest.name;
      const actions: string[] = [];
      for (const entry of declaration.entries) {
        const claimed = byAction.get(entry.action);
        if (claimed) {
          throw new RecentActivityActionConflict(
            `[audit_logs] modules "${claimed.moduleId}" and "${moduleId}" both declare the ` +
              `recent-activity action "${entry.action}". The token decides whose visibility ` +
              `Setting governs the row and in whose i18n namespace its verb is resolved, so ` +
              `there is no winner to pick: one of the two declarations is wrong.`,
          );
        }
        byAction.set(entry.action, {
          action: entry.action,
          moduleId,
          moduleName,
          icon: entry.icon,
          labelKey: entry.labelKey,
        });
        actions.push(entry.action);
      }
      modules.push({
        moduleId,
        moduleName,
        // Derived, never declared — see the contracts helper's note.
        settingCode: recentActivityVisibilitySettingCode(moduleId),
        actions,
      });
    }
    this.byAction = byAction;
    this.modules = modules;
  }

  /** Every declared action token, sorted so the derived route enum is stable. */
  actions(): string[] {
    return [...this.byAction.keys()].sort();
  }

  /** Every declaring module's id — what `RecentActivityModule` used to enumerate. */
  moduleIds(): string[] {
    return this.modules.map((entry) => entry.moduleId).sort();
  }

  /** Every eligible module, in composition order. */
  eligibleModules(): readonly RecentActivityModuleEntry[] {
    return this.modules;
  }

  /**
   * The descriptor for an action token, or `undefined` for one nobody declared.
   *
   * `undefined` rather than a throw, unlike the `moduleForAction` this replaced:
   * that function's own comment called an unmapped token "defensive:
   * unreachable as long as the allowlist and the prefix table stay aligned",
   * and they were not aligned. A row can only get here by being in the query's
   * `$in`, which is built from this same map — but an operator flipping a
   * module off between the two is a real interleaving, and taking the dashboard
   * down for it would be worse than omitting a row.
   */
  descriptorFor(action: string): RecentActivityDescriptor | undefined {
    return this.byAction.get(action);
  }
}
