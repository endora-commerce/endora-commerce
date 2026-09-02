import {
  PERMISSION_CATALOGUE,
  type ModuleManifest,
  type PermissionCatalogueEntry,
} from '@endora-commerce/contracts';

export interface PermissionCatalogueServiceOptions {
  registryEntries: ReadonlyArray<{ manifest: ModuleManifest }>;
  /**
   * **The effective presence of a module — both axes, not one** (issue #213).
   *
   * This used to be `getEnabledModuleIds`, wired by both composition roots to
   * `registryCache.enabledIds()`. That set is the **platform** axis alone: an
   * operator deactivation leaves the id in it, so every one of the 65 modules
   * kept contributing its permission codes to `/admin-roles` after the operator
   * switched it off — the exact conflation Constitution XVII exists to prevent,
   * shipped.
   *
   * The catalogue answers "may an operator grant this today?", and presence is
   * the conjunction of platform availability and operator activation, so this
   * predicate is `effectiveState.isPresent` and nothing narrower. It is spelled
   * out here rather than left to the wiring because the two axes are the thing
   * people conflate, and a predicate named after one of them invites it back.
   *
   * **The two off states are not distinguished on this surface, deliberately.**
   * Principle XVII item 5 asks a platform-*unavailable* module to render as
   * absent or blocked-with-a-reason rather than merely "switched off" — that
   * distinction is about a module's *own* surfaces, where an operator can act on
   * the reason. `/admin-roles` renders a flat list of grantable codes: it has no
   * per-module row to carry a reason, and no action an operator could take from
   * there differs between the two cases. Absent is the whole answer. The screen
   * that owes the distinction is `/platform/modules`, and it renders it.
   *
   * Omitted ⇒ every registered module counts as present. That is the
   * pre-composition path (the CI helper below, unit tests), not a fall-open: a
   * presence read before the registry cache is loaded throws
   * `ModulePresenceNotLoadedError` rather than answering, so an unwired
   * catalogue cannot be mistaken for a loaded one that found nothing.
   */
  isModulePresent?: (moduleId: string) => boolean;
}

/**
 * One merged catalogue row plus the modules entitled to contribute it.
 *
 * `module` is a **display grouping** and `owners` is a **presence question**;
 * they are not the same string and treating them as one is a defect waiting to
 * happen. `_lifecycle` declares its codes under `module: 'module_lifecycle'`,
 * which is no module id at all, so filtering on `module` would delete the
 * lifecycle permissions from every deployment.
 *
 * `owners` is a set because a code can be shared: `integrations:manage` gates
 * both the API-keys and the webhooks admin surfaces. A shared code survives as
 * long as **any** of its owners is present — switching `webhooks` off must not
 * take the API-keys screen's own gate off the role editor.
 */
interface MergedRow {
  readonly entry: PermissionCatalogueEntry;
  readonly owners: ReadonlySet<string>;
}

/**
 * Merges the core `PERMISSION_CATALOGUE` with the `permissions` arrays of every
 * registered module manifest. Powers `GET /admin/permissions` and role upsert
 * validation (feature 026).
 *
 * **There is no memo, and that is the design** (issue #213). `listAssignable()`
 * cached its result into a field that only an explicit `invalidate()` cleared,
 * and the two things that had to call it — a Redis pub/sub listener in each
 * composition root — were a duplicated wiring step rather than a property of the
 * service. That is the shape of issue #33 (an admin "clear cache" action that
 * missed the per-process LRU) and issue #45 (an invalidation that depended on
 * subscriber registration order) for the third time. Now that the value tracks a
 * Setting an operator flips from the Admin UI at runtime, a per-process memo can
 * only be wrong between the flip and whatever drops it.
 *
 * Nothing is lost by dropping it: every input is already in memory — the
 * manifests are fixed at composition and the presence predicate reads the
 * registry cache, which does its own refreshing — so a call is a map build and a
 * sort over a few hundred rows, on two admin-only paths. There is no ordering
 * trap to test because there is no invalidation to order.
 */
export class PermissionCatalogueService {
  private readonly isModulePresent: (moduleId: string) => boolean;

  constructor(private readonly options: PermissionCatalogueServiceOptions) {
    this.isModulePresent = options.isModulePresent ?? ((): boolean => true);
  }

  /**
   * The grantable set: what `/admin-roles` renders and what an operator may
   * newly grant. Presence-filtered, so a module that is off contributes nothing
   * (Constitution XVII item 5).
   */
  listAssignable(): PermissionCatalogueEntry[] {
    return this.#merge()
      .filter((row) => [...row.owners].some((owner) => this.isModulePresent(owner)))
      .map((row) => row.entry);
  }

  listAssignableCodes(): string[] {
    return this.listAssignable().map((e) => e.code);
  }

  /**
   * Every code the platform knows, present or not — the **vocabulary**, not the
   * grantable set.
   *
   * Role upsert validates against this rather than against `listAssignable()`,
   * and the difference is what keeps "off is non-destructive and reversible"
   * true. An "Editor" role holds `blog.read`; the operator switches `blog` off
   * and then renames the role. Validating the submitted list against the
   * grantable set would answer 400 `Unknown permission(s): blog.read` — the
   * operator either loses the role or silently drops a grant that must come back
   * when `blog` does. A code of an absent module grants access to nothing anyway:
   * the routes behind it answer 503 `MODULE_DISABLED` at their own seam.
   *
   * This is what the role editor already relies on: `AdminRolesPage` seeds its
   * selection from the **role's** codes and renders a checkbox only for the ones
   * the catalogue offers, so an absent module's grant is carried through the
   * round trip untouched and simply has no checkbox to un-tick while the module
   * is off. Narrowing this method would turn that into a silent revocation.
   */
  listKnownCodes(): string[] {
    return this.#merge().map((row) => row.entry.code);
  }

  /**
   * Every code the platform knows, mapped to the modules whose presence keeps
   * it grantable — {@link MergedRow.owners}, published.
   *
   * D-173's sweep reads it, and it is a method rather than a derivation of its
   * own because the whole question is *"does `/admin-roles` still offer this
   * code when its owner is switched off?"* — a question only the merge this
   * class performs can answer. A second implementation over
   * `PERMISSION_CATALOGUE` plus the manifests would be right on the day it was
   * written and would drift the first time the merge learns a rule: a shared
   * code with two owners, or a catalogue row a manifest re-declares, is exactly
   * where the two would disagree, and exactly the shape the sweep exists for.
   */
  listOwnersByCode(): Map<string, ReadonlySet<string>> {
    return new Map(this.#merge().map((row) => [row.entry.code, row.owners]));
  }

  /**
   * The codes `moduleId` contributes, whether or not it is present.
   *
   * Exists for the off-state harness: proving a module's codes leave the
   * grantable set needs to know which codes are its, and deriving that from the
   * `module` display field would silently measure nothing for `_lifecycle`.
   */
  listOwnedCodes(moduleId: string): string[] {
    return this.#merge()
      .filter((row) => row.owners.has(moduleId))
      .map((row) => row.entry.code);
  }

  #merge(): MergedRow[] {
    const byCode = new Map<string, { entry: PermissionCatalogueEntry; owners: Set<string> }>();

    // Core first: a core row wins the label and the display module on a code
    // collision, which is the long-standing behaviour and what the dedupe test
    // pins. Its `module` is a real module id — `audit_log:read` says so in its
    // own comment (feature 072, T017).
    for (const row of PERMISSION_CATALOGUE) {
      byCode.set(row.code, {
        entry: { code: row.code, module: row.module, label: row.label },
        owners: new Set([row.module]),
      });
    }

    for (const { manifest } of this.options.registryEntries) {
      if (!manifest.permissions?.length) continue;
      for (const decl of manifest.permissions) {
        const existing = byCode.get(decl.code);
        if (existing) {
          // A second declarer of an already-known code contributes an owner and
          // nothing else — the row keeps the first label it was given.
          existing.owners.add(manifest.id);
          continue;
        }
        byCode.set(decl.code, {
          entry: {
            code: decl.code,
            module: decl.module ?? manifest.id,
            label: decl.label,
          },
          owners: new Set([manifest.id]),
        });
      }
    }

    return [...byCode.values()].sort(
      (a, b) =>
        a.entry.module.localeCompare(b.entry.module) ||
        a.entry.code.localeCompare(b.entry.code),
    );
  }
}

/** Test / CI helper — build assignable codes without wiring composition. */
export function listAssignablePermissionCodes(
  registryEntries: ReadonlyArray<{ manifest: ModuleManifest }>,
  presentModuleIds?: readonly string[],
): string[] {
  const present = presentModuleIds === undefined ? null : new Set(presentModuleIds);
  return new PermissionCatalogueService({
    registryEntries,
    ...(present ? { isModulePresent: (id: string): boolean => present.has(id) } : {}),
  }).listAssignableCodes();
}
