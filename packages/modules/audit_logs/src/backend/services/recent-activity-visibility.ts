import { z } from 'zod';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { RecentActivityCatalog } from './recent-activity-catalog.js';

/**
 * The operator axis of D-163.1 — feature 080, T042j.
 *
 * A module **declares** that its activity is eligible for the dashboard's
 * recent-activity card (`manifest.ts`'s `recentActivity` export). The operator
 * **chooses** whether it actually appears, and **the default is that it does**.
 * Neither axis overwrites the other and neither is derivable from the other,
 * which is Constitution XVII's shape applied to a narrower object.
 *
 * **This is a second per-module operator toggle beside activation, and that is
 * deliberate.** They answer different questions about the same module —
 * "does this client want stock management at all" versus "does this client want
 * stock movements on their home screen" — so one control cannot carry both.
 * They differ in kind too: activation is *presence*, resolved synchronously on
 * the hot path by the kernel's registry cache and gating every seam the module
 * owns; this is a *display* preference on one card, resolved asynchronously
 * through `settingsReadPort` on the one request that renders it. That is why
 * this is not built on the activation resolver: reading it there would put a
 * dashboard preference into the presence machinery every request already
 * consults.
 *
 * **Defaulting to visible has one consequence, stated so nobody meets it as a
 * surprise** (D-163.1): a newly installed third-party module's activity reaches
 * the shop owner's home screen without anyone choosing it. The alternative
 * default makes every module's first useful signal depend on an operator
 * knowing to go looking for a toggle whose existence the module cannot
 * announce.
 */

const visibleSchema = z.boolean();

/** One module's answer, for the admin screen. */
export interface RecentActivityModuleVisibility {
  moduleId: string;
  moduleName: string;
  visible: boolean;
}

export class RecentActivityVisibility {
  constructor(
    private readonly catalog: RecentActivityCatalog,
    private readonly settings: SettingsReadPort,
  ) {}

  /**
   * Every eligible module with the operator's current answer.
   *
   * One batch read, `salesChannelId: null` — the choice is platform-wide, for
   * the reason activation is (FR-009): a home dashboard is not per-storefront,
   * and joining `setting_values` would reintroduce channel dependence through
   * the back door (Constitution XII).
   *
   * A code the settings store does not know resolves to **visible**, not to
   * hidden. The row is created by the boot reconcile for a shipped module and
   * by `install` for a package, so its absence means one has not run yet — a
   * platform mid-install, not an operator's decision — and the ruling's default
   * is the honest answer to "nobody has chosen".
   */
  async list(): Promise<RecentActivityModuleVisibility[]> {
    const modules = this.catalog.eligibleModules();
    if (modules.length === 0) return [];
    const rows = await this.settings.getMany(
      modules.map((entry) => entry.settingCode),
      null,
    );
    return modules.map((entry) => {
      const row = rows.get(entry.settingCode);
      return {
        moduleId: entry.moduleId,
        moduleName: entry.moduleName,
        visible: row?.ok === true ? visibleSchema.safeParse(row.value).data ?? true : true,
      };
    });
  }

  /**
   * The action tokens the card may query — the conjunction of the two axes.
   *
   * Empty when every eligible module is hidden, and the caller must not turn
   * that into "no filter": an unfiltered query would put every audited write on
   * the dashboard, which is the opposite of what the operator asked for.
   */
  async visibleActions(): Promise<string[]> {
    const visibility = new Map(
      (await this.list()).map((entry) => [entry.moduleId, entry.visible]),
    );
    return this.catalog
      .eligibleModules()
      .filter((entry) => visibility.get(entry.moduleId) !== false)
      .flatMap((entry) => [...entry.actions]);
  }
}
