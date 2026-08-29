import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest, RegistryState } from '@endora-commerce/contracts';
import { ModuleRegistration } from '../../kernel/lifecycle/module-registration.entity.js';
import { activationDeclarationsFrom } from '../../kernel/lifecycle/activation-resolver.js';
import { installGatingGraph } from './gating-graph.js';
import { registryCache } from '../../kernel/lifecycle/registry-cache.js';
import {
  deploymentShippedEntries,
  type ModuleIdClaimOrigin,
} from './module-origin.js';

/** One module that needs an absent one, and how it says so. */
export interface NeededBy {
  readonly moduleId: string;
  readonly via: 'dependencies' | 'acknowledgedDependencies';
  /** The registration it resolves — `acknowledgedDependencies` only. */
  readonly port: string | null;
}

/**
 * The three ways a composition can be missing something it composes against.
 *
 *  - `not-shipped` — a module names another in `dependencies` or
 *    `acknowledgedDependencies` and this deployment does not ship it.
 *  - `not-installed` — the module ships, but its `module_registrations` row
 *    says otherwise and the boot reconciler will not repair it (it inserts
 *    only).
 *  - `stale-declaration` — the deployment declared an omission it no longer
 *    makes.
 */
export type ReducedDeploymentFinding =
  | { readonly kind: 'not-shipped'; readonly moduleId: string; readonly neededBy: readonly NeededBy[] }
  | {
      readonly kind: 'not-installed';
      readonly moduleId: string;
      readonly state: RegistryState;
      /** The module's own `activation.reason` — why the platform cannot run without it. */
      readonly reason: string;
    }
  | { readonly kind: 'stale-declaration'; readonly moduleId: string };

/**
 * The boot refuses: this deployment composes modules that need modules it does
 * not have, and has not said so (D-101).
 *
 * A distinct type from every deactivation refusal on purpose. `assertDeactivatable`
 * refuses a **transition** an operator asked for and answers them with an HTTP
 * envelope; this refuses an **initial state** nobody asked about, and answers the
 * person who composed the deployment, at their terminal, before anything serves.
 * Merging the two would re-make exactly the conflation D-100 exists to stop.
 */
export class ReducedDeploymentError extends Error {
  readonly findings: readonly ReducedDeploymentFinding[];

  constructor(findings: readonly ReducedDeploymentFinding[]) {
    super(refusalMessage(findings));
    this.name = 'ReducedDeploymentError';
    this.findings = findings;
  }
}

const LEDGER_PATH = 'backend/src/apps/<deployment>/reduced-deployment.ts';

function refusalMessage(findings: readonly ReducedDeploymentFinding[]): string {
  const lines: string[] = [
    'This deployment will not boot: it composes modules whose declarations it does not satisfy.',
    '',
  ];
  for (const finding of findings) {
    if (finding.kind === 'not-shipped') {
      lines.push(`  ${finding.moduleId} — not shipped by this deployment, and it is needed:`);
      for (const needer of finding.neededBy) {
        lines.push(
          `      ${needer.moduleId} — ${needer.via}` +
            (needer.port === null ? '' : `, port \`${needer.port}\``),
        );
      }
    } else if (finding.kind === 'not-installed') {
      lines.push(
        `  ${finding.moduleId} — shipped, but \`module_registrations\` says \`${finding.state}\`,`,
        `      and the platform cannot run without it: ${finding.reason}`,
        `      remedy: pnpm --filter backend run module:enable ${finding.moduleId}`,
      );
    } else {
      lines.push(
        `  ${finding.moduleId} — declared as omitted, but this deployment ships it and its row is fine.`,
        `      Remove the entry from ${LEDGER_PATH}; a declaration nothing omits is how a`,
        '      deployment silently reacquires the hazard it once declared.',
      );
    }
    lines.push('');
  }
  lines.push(
    'Ship the modules, or — if the omission is deliberate — declare each one, with a reason,',
    `in ${LEDGER_PATH}. The declaration is reviewed in the merge request that assembles the`,
    'deployment, which a flag set at 2 a.m. is not (D-69, D-101).',
  );
  return lines.join('\n');
}

/**
 * Refuse a composition that never shipped what it composes against — D-101,
 * the owner's E1 ruling: *"the failure belongs to whoever composes the
 * deployment, loudly and immediately — not to a user who meets it as a 503 at
 * login."*
 *
 * **Pure, and that is load-bearing rather than stylistic.** The harness never
 * calls {@link loadModulePresence} — it seeds the registry cache directly — so a
 * refusal that only existed inside the boot step would have no proof that runs.
 * Its whole input is the three things a composition has: what it ships, what the
 * registry says, and what it declared.
 *
 * `rows === null` means *the registry has not been read yet*. The shipping
 * question is answerable without it, so it is asked first, before
 * `reconcileExistingModules` touches the database.
 *
 * **What it does not read: the absent module's manifest.** The decision is
 * framed around `activation.nonDeactivatable`, and for the "shipped but not
 * installed" trigger that is exactly what it asks. For the *not shipped* trigger
 * it cannot: a packaging split that drops `admin_users` drops its manifest with
 * it, so "was it locked?" has no answer at the seam that has to refuse. What
 * survives the split is the **declaration in the module that stays** —
 * `admin_roles`' `acknowledgedDependencies` entry — and that is what this rests
 * on. It is deliberately wider than "locked modules only", and D-100 points the
 * same way: an argument from a lock nothing here can re-derive is the shape that
 * goes stale. `nonBindingDependencies` is left out, because that array is the
 * declaration that the owner's absence is expected and handled (D-44).
 */
export function assertLockedModulesPresent(
  manifests: readonly ModuleManifest[],
  rows: ReadonlyMap<string, RegistryState> | null,
  declared: ReadonlySet<string>,
): void {
  const shipped = new Set(manifests.map((manifest) => manifest.id));
  const findings: ReducedDeploymentFinding[] = [];

  // 1 — not shipped. Both ends of every missing edge, because a message naming
  // only the absentee sends the reader hunting across three arrays in 65
  // manifests.
  const neededBy = new Map<string, NeededBy[]>();
  const need = (moduleId: string, entry: NeededBy): void => {
    if (shipped.has(moduleId) || declared.has(moduleId)) return;
    const list = neededBy.get(moduleId) ?? [];
    list.push(entry);
    neededBy.set(moduleId, list);
  };
  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies ?? []) {
      need(dependency, { moduleId: manifest.id, via: 'dependencies', port: null });
    }
    for (const edge of manifest.acknowledgedDependencies ?? []) {
      need(edge.moduleId, {
        moduleId: manifest.id,
        via: 'acknowledgedDependencies',
        port: edge.port,
      });
    }
  }
  for (const [moduleId, needers] of [...neededBy.entries()].sort()) {
    findings.push({ kind: 'not-shipped', moduleId, neededBy: needers });
  }

  if (rows !== null) {
    // 2 — shipped, but carrying a row the boot reconciler will not repair. By
    // construction this is not an operator's choice: since D-69 the orchestrator
    // refuses to disable or uninstall a `nonDeactivatable` module, with no
    // `--force`, so the only way to hold one is to have written it before that
    // refusal landed. The reconciler must not repair it — it inserts only, and
    // deciding a state rather than converging to one is the orchestrator's job —
    // so the refusal names the remedy instead.
    for (const manifest of manifests) {
      const activation = manifest.activation;
      if (activation === undefined || !('nonDeactivatable' in activation)) continue;
      if (declared.has(manifest.id)) continue;
      const state = rows.get(manifest.id);
      if (state === undefined || state === 'installed') continue;
      findings.push({
        kind: 'not-installed',
        moduleId: manifest.id,
        state,
        reason: activation.reason,
      });
    }

    // 3 — the declaration is two-way. An entry for a module this deployment
    // ships, in the state it should be in, describes a deployment that no longer
    // exists. Asked only once the registry has been read: a shipped module with a
    // legacy row is a live declaration, not a stale one.
    for (const moduleId of [...declared].sort()) {
      if (!shipped.has(moduleId)) continue;
      const state = rows.get(moduleId);
      if (state !== undefined && state !== 'installed') continue;
      findings.push({ kind: 'stale-declaration', moduleId });
    }
  }

  if (findings.length > 0) throw new ReducedDeploymentError(findings);
}

/**
 * The composition step that gives module presence an answer (feature 072,
 * D-38).
 *
 * It used to live in `_lifecycle`'s Fastify plugin body, which runs inside
 * `buildServer` — after `composeApp()` has registered every module and run every
 * boot hook. Eleven boot hooks resolve a gated port, so they all asked a cache
 * nothing had loaded, all got "not installed", and the first one reached threw
 * `ModuleCompositionError` before the process could listen. The ordering was the
 * bug; the cache, the gate and the composer were each doing exactly their job.
 *
 * So this is called from the composition root **before the first module
 * registers**, and it is awaited and fatal: its two inputs are the EntityManager
 * factory and the manifest list, and a root has both before it composes
 * anything. Redis is not involved — arming the notification channel is
 * `registryCache.watch()`, which happens after composition and cannot fail a
 * boot.
 *
 * It lives under `lifecycle/` rather than in `kernel/` even though D-37 A1 moved
 * the cache, the resolver and the gating wrappers into the kernel. The reason is
 * `installGatingGraph` below: the graph's *fallback* is the host's manifest
 * registry, which the harness relies on without ever calling this function, so
 * the two belong to the same subsystem. D-37 §2.3 records the call as deliberate
 * and arguable; the call site is already where it needs to be either way.
 */
export async function loadModulePresence(opts: {
  em: () => EntityManager;
  /**
   * The **instance-resolved** manifest set: core, this deployment's overlay
   * modules, and every installed Endora module package
   * (`resolvedManifestEntries()`).
   *
   * Entries rather than bare manifests because one of the four things done with
   * them — the first-boot insert — is narrower than the other three, and
   * `filePath` is what says which entry belongs to it (D-157.6(b)).
   */
  entries: readonly ShippedModuleEntry[];
  /**
   * The module ids this deployment declares it deliberately does not ship —
   * `backend/src/apps/<deployment>/reduced-deployment.ts`, read by the host.
   *
   * **Injected** (feature 080, D-160.11). This step used to call
   * `loadReducedDeploymentDeclarations()` itself, which reads the deployment
   * root out of `backend/src/overlay/` — a directory the platform may not name
   * and could not publish (D-52/D-53, §1.4l). Which deployment a process runs
   * as is a fact about the process, so the root that already resolved it hands
   * the answer down rather than the platform going to look for it.
   *
   * Omitting it declares *no* omission, which is the fail-closed direction: an
   * undeclared absence is exactly what {@link assertLockedModulesPresent}
   * refuses on, so a root that forgot to pass this gets a refusal naming the
   * missing module rather than a boot that proceeds.
   */
  declaredOmissions?: readonly string[];
}): Promise<void> {
  const manifests = opts.entries.map((entry) => entry.manifest);
  // D-101 — two refusals, in the order the two questions can be answered.
  //
  // The **shipping** question needs no database, so it is asked first: a
  // deployment that never shipped what it composes fails before a connection is
  // used, and the person who assembled it reads the failure instead of a user
  // meeting it as a 503 at login. The **registry** question needs the rows, and
  // is asked once they are read.
  //
  // Both are one line here because the analysis is a pure function beside this
  // one: the harness never calls `loadModulePresence`, so a refusal written into
  // this body would have no proof that runs.
  const declared = new Set(opts.declaredOmissions ?? []);
  assertLockedModulesPresent(manifests, null, declared);
  // D-157.6(b) — and this is the one place the resolved set is narrowed. The
  // insert converges the registry to what this **build** ships; a package is
  // converged by `module:install`, which is also what runs its migrations.
  const rows = await reconcileExistingModules(
    opts.em,
    firstBootInsertPopulation(opts.entries),
  );
  assertLockedModulesPresent(manifests, rows, declared);
  // Feature 073 (T045/T046) — the graph the flip-time refusals read. Installed
  // from the same manifest list as the activation declarations, so an overlay
  // module's edges count for a refusal exactly as a core module's do (FR-027).
  installGatingGraph(manifests);
  await registryCache.load({
    em: opts.em,
    // Feature 073 — the operator-activation axis. Declarations come from the
    // shipped manifests, so there is no hand-maintained list: a module that
    // declares no control is governed by the platform axis alone.
    activationDeclarations: activationDeclarationsFrom(manifests),
  });
}

/**
 * A manifest plus the file that claims it. The minimum
 * {@link loadModulePresence} needs, so a caller can hand it
 * `resolvedManifestEntries()`' output and a test can hand it two fields.
 */
export interface ShippedModuleEntry {
  readonly manifest: ModuleManifest;
  readonly filePath: string;
  /**
   * Which discovery produced this entry — core (the generated index, including
   * a module that has become a workspace package), the deployment's overlay, or
   * an installed package. It is a field rather than a containment test on
   * `filePath` since feature 080's T040b; the reason is on
   * `RegisteredManifestEntry.origin`.
   */
  readonly origin: ModuleIdClaimOrigin;
}

/**
 * The first-boot reconciler's insert population: **core plus this deployment's
 * overlay**, never the instance-resolved set (D-157.6(b)).
 *
 * T031 made `composeApp` hand the resolved set — which since then includes every
 * installed Endora module package — to {@link loadModulePresence}, and the
 * reconciler inserts `state='installed'` for every manifest with no row. So the
 * next boot after `pnpm add @vendor/some-module` converged that package before
 * one migration of its had run, `module:install` answered `already-installed`
 * and returned 0, and the operator was left with a module whose tables do not
 * exist. A package is installed by `install` — the mechanism that applies its
 * migrations, reconciles its settings and runs its install hook — and
 * converging it silently is the one thing that mechanism cannot survive.
 *
 * **Only the insert is narrowed.** The presence *cache* still loads over the
 * full resolved set, so a package that **has** been installed is present, gated
 * and deactivatable exactly like a core module. Narrowing the cache too would
 * trade a silent install for a silent absence.
 *
 * Pure, and separate from the boot step for the same reason
 * {@link assertLockedModulesPresent} is: the harness never calls
 * {@link loadModulePresence}, so a rule written into that body would be proved
 * by nothing that runs.
 *
 * The origin split itself is `deploymentShippedEntries` and is deliberately not
 * spelled here (feature 080, T046): the boot settings reconcile has to stop at
 * the same line, for reasons of its own, and a second copy of an origin test is
 * two answers waiting to disagree (D-100).
 */
export function firstBootInsertPopulation(
  entries: readonly ShippedModuleEntry[],
): ModuleManifest[] {
  return deploymentShippedEntries(entries).map((entry) => entry.manifest);
}

/**
 * First-boot reconciler — idempotent.
 *
 * For every shipped manifest with NO row in `module_registrations`, inserts one
 * with `state='installed'`. This lets feature 018 land on a running platform
 * without breaking the gating wrappers (`defineModuleRoutes`,
 * `defineModuleWorker`, `subscribeForModule`) — pre-existing modules continue
 * serving traffic because their auto-created row marks them
 * installed-and-enabled.
 *
 * Modules added AFTER feature 018 ships go through the explicit
 * `module:install <id>` flow.
 *
 * command-coverage-ignore: boot convergence of the registry to the shipped
 * manifest list — a system-invariant repair with no operator behind it. Spelled
 * out, because "a reconcile is not a write" is exactly the argument that lets a
 * real unaudited write through next time:
 *
 * **Why the hatch appears only now.** The write is feature 018's, unchanged
 * since 2026-05-06. It lived in `_lifecycle/plugin.ts`, which
 * `check-command-coverage` did not scan at the time — it judged
 * `modules/<m>/services/*.ts` and nothing else, one level deep (issue #122
 * widened it to every file a module owns) — and D-38 moved it here, into a
 * services file, when presence became a composition step. So what changed in
 * feature 072 is the check's line of sight, not the decision being made;
 * nothing about the reconcile became sensitive on the way across.
 *
 * **What it writes.** One `module_registrations` row per shipped manifest that
 * has none, carrying `state='installed'` and the manifest's version. Inserts
 * only: it skips every id that already has a row, so it never updates a state,
 * never bumps a version, never deletes. It therefore cannot overwrite an
 * operator's platform-availability choice, and it does not touch the operator
 * activation axis at all — that lives in the settings store (Principle XVII).
 * On a converged database it writes nothing.
 *
 * **Why no actor exists.** It runs from `composeApp()` before the first module
 * registers, inside
 * `enterSystemScope('boot: load module presence', …, { entryPoint: 'boot' })`.
 * There is no admin user and no request to attribute it to; the identity the
 * path does have is that scope, and `enterSystemScope` already reports it
 * through `recordEscapeHatchAudit` (`tenant.escape_hatch`, with the reason and
 * `entryPoint: 'boot'`). A Command would add one `actorAdminUserId: null` entry
 * per boot per deployment, diluting the `module.*` trail the orchestrator
 * writes for the transitions an operator really did request.
 *
 * **What would make a future change need a Command.** Any write here that
 * *decides* rather than converges: updating `state` or `version` on an existing
 * row, deleting the row of a manifest this deployment no longer ships, or
 * deriving what to write from anything other than the shipped manifest list.
 * Each of those changes an operator's platform-availability answer, and those
 * transitions belong to `LifecycleOrchestrator`, which audits every one of them
 * (`module.installed`, `module.enabled`, `module.disabled`, …). If this
 * function ever needs one of them, the write moves there — the hatch does not
 * stretch to cover it.
 */
async function reconcileExistingModules(
  emFactory: () => EntityManager,
  manifests: readonly ModuleManifest[],
): Promise<ReadonlyMap<string, RegistryState>> {
  const em = emFactory();
  const existing = await em.find(ModuleRegistration, {});
  const existingIds = new Set(existing.map((r) => r.moduleId));
  const now = new Date();
  for (const manifest of manifests) {
    if (existingIds.has(manifest.id)) continue;
    em.create(ModuleRegistration, {
      moduleId: manifest.id,
      state: 'installed',
      version: manifest.version,
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
  }
  await em.flush();
  // The rows as they were **before** this converged them, which is what D-101's
  // second trigger asks about: a row it just inserted says `installed` by
  // construction, and a row it left alone is the one the reconciler will not
  // repair.
  return new Map(existing.map((row) => [row.moduleId, row.state]));
}
