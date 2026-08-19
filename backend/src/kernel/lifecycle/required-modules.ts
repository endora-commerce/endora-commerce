import type { ModuleManifest, RegistryState } from '@b2b/contracts';

/**
 * The modules a composition is **required to have**, and the refusal when it
 * does not (issue #258, owner ruling: *"`settings` is too important to be
 * absent from a deployment"*).
 *
 * ## The gap this closes
 *
 * `activation.nonDeactivatable` guards **withdrawal**: since D-69 the lifecycle
 * orchestrator refuses to disable or uninstall a module that declares it, soft
 * and hard alike, with no `--force`. D-101 then bound the **initial state** for
 * the two absences a manifest analysis can see — a module this deployment never
 * shipped that another manifest names, and a module carrying a
 * `module_registrations` row the boot reconciler will not repair. Both refuse
 * from `loadModulePresence`, before the registry is even read.
 *
 * Neither of them can see the state that actually breaks a first boot: presence
 * answering *absent* for a required module at the moment the boot phase starts.
 * `loadModulePresence` runs before the first module registers, so it knows the
 * manifests but not what was composed; and it is the *first* writer of presence,
 * not the only one. This runs at the other end of the registration pass, where
 * both answers exist at once.
 *
 * ## What a mis-built deployment used to see
 *
 * `invoices` grandfathers its numbering pattern from a `ctx.onBoot` hook
 * (feature 078, D-95.3) and the write goes through `settings`' port.
 * `NumberingConfigurationService` re-throws `ModuleDisabledError` on purpose —
 * the write is the whole point of the hook — `runBootHooks` attributes the
 * failure to `invoices` and re-throws as `ModuleCompositionError`, and
 * `index.ts` turns that into `process.exit(1)`. So the platform did not degrade,
 * it exited, saying:
 *
 *     [kernel] module 'invoices' failed in its boot hook:
 *     Module 'settings' is currently disabled.
 *
 * — the wrong module, and no remedy. It had never been seen because on any
 * database where the platform booted once the grandfather write has already
 * happened and the hook finds nothing to do; only a genuinely first boot reaches
 * the port.
 *
 * ## Why this is not `assertDeactivatable` and not `assertLockedModulesPresent`
 *
 * Three refusals now rest on one manifest declaration, and D-101 already ruled
 * that they must stay three: *"they share a declaration and share nothing else —
 * not a call site, not an error type, not a message. Anyone reading either
 * should be able to tell which question they are looking at without reading the
 * other."* `assertDeactivatable` refuses a **transition an operator asked for**
 * and answers it with an HTTP envelope. `assertLockedModulesPresent` refuses a
 * **deployment that was assembled wrong**, from the manifests, before the
 * database is touched. This refuses a **composition that reached its boot phase
 * without a module it requires**, from what was actually registered and what
 * presence actually says — the last question, at the last point where the answer
 * is still cheap.
 *
 * ## The required set is derived, never written down
 *
 * D-100 and `check:lock-claims`: a hand-written copy of a derived fact goes stale
 * silently. {@link requiredModulesFrom} reads the shipped manifests on every
 * composition, so an owner who withdraws a lock changes this refusal in the same
 * run, with no list to edit. **"Required to be installed" and "cannot be switched
 * off" are therefore the same set, by derivation and by decision** — the manifest
 * needs no second field, because a module whose author wrote "the platform cannot
 * run without this" has already answered both questions with one sentence, and
 * that sentence is what the refusal below prints.
 *
 * The one absence it cannot see is the one D-101's header names: a module that is
 * not shipped at all takes its manifest with it, so *"was it locked?"* has no
 * answer here. That case belongs to `assertLockedModulesPresent`, which asks it
 * from the declarations of the modules that stayed.
 */

/** A module this composition must have, and the sentence its manifest gives. */
export interface RequiredModule {
  readonly moduleId: string;
  /** The module's own `activation.reason` — why the platform cannot run without it. */
  readonly reason: string;
}

/**
 * The two ways a composition can reach its boot phase without a module it
 * requires.
 *
 *  - `not-composed` — the manifests declare it, but no module registered it.
 *    The composed module list and the manifest index disagree, which is a
 *    mis-built artefact rather than an operator's choice.
 *  - `absent` — it was composed, and presence says it is not there. For a
 *    required module that is always the platform axis: `effectiveState` forces
 *    the operator axis of a non-deactivatable module on whatever a Setting says,
 *    so there is no operator choice that can produce this.
 */
export type RequiredModuleFinding =
  | { readonly kind: 'not-composed'; readonly moduleId: string; readonly reason: string }
  | {
      readonly kind: 'absent';
      readonly moduleId: string;
      readonly reason: string;
      readonly platformState: RegistryState | 'not-installed';
    };

/**
 * The presence answers this analysis needs, and nothing else — structurally the
 * two `EffectiveModuleState` members it uses, so a fixture supplies them and
 * nothing more.
 */
export interface RequiredModulePresence {
  isPresent(moduleId: string): boolean;
  presence(
    moduleId: string,
  ): { readonly platformState: RegistryState | 'not-installed' } | undefined;
}

/**
 * The refusal. A distinct type from every other absence refusal, per D-101's
 * closing rule.
 */
export class RequiredModuleAbsentError extends Error {
  readonly findings: readonly RequiredModuleFinding[];

  constructor(findings: readonly RequiredModuleFinding[]) {
    super(refusalMessage(findings));
    this.name = 'RequiredModuleAbsentError';
    this.findings = findings;
  }
}

function refusalMessage(findings: readonly RequiredModuleFinding[]): string {
  const lines: string[] = [
    'This deployment will not start: its boot phase was reached without a module it requires.',
    '',
  ];
  for (const finding of findings) {
    if (finding.kind === 'not-composed') {
      lines.push(
        `  ${finding.moduleId} — declared by this deployment's manifests, but no module registered it,`,
        `      and the platform cannot run without it: ${finding.reason}`,
        '      remedy: the composed module list and the manifest index disagree — run',
        '              `pnpm --filter backend run composer:generate` and rebuild.',
      );
    } else {
      lines.push(
        `  ${finding.moduleId} — composed, but module presence says \`${finding.platformState}\`,`,
        `      and the platform cannot run without it: ${finding.reason}`,
        `      remedy: pnpm --filter backend run module:enable ${finding.moduleId}`,
      );
    }
    lines.push('');
  }
  lines.push(
    'A module whose manifest declares `activation.nonDeactivatable` is required to be present,',
    'not merely un-switch-off-able: the orchestrator refuses to disable or uninstall it, and this',
    'refuses a composition that reached its boot phase without it. Starting anyway means every',
    'boot hook, route and worker that needs it fails one at a time, naming whichever module',
    'happened to ask first.',
  );
  return lines.join('\n');
}

/**
 * The required set, straight from the shipped manifests.
 *
 * Pure and exported so its proof drives the classification from a fixture that
 * enters at the top of the analysis, rather than from a value a composition
 * already computed.
 */
export function requiredModulesFrom(
  manifests: readonly ModuleManifest[],
): readonly RequiredModule[] {
  const required: RequiredModule[] = [];
  for (const manifest of manifests) {
    const activation = manifest.activation;
    if (activation === undefined || !('nonDeactivatable' in activation)) continue;
    required.push({ moduleId: manifest.id, reason: activation.reason });
  }
  return required;
}

/**
 * Every required module this composition cannot serve, in manifest order.
 *
 * Pure, and that is load-bearing rather than stylistic — the same reason
 * `assertLockedModulesPresent` is: its whole input is the three things a
 * composition has by the end of its registration pass.
 */
export function absentRequiredModules(
  required: readonly RequiredModule[],
  composed: ReadonlySet<string>,
  presence: RequiredModulePresence,
): readonly RequiredModuleFinding[] {
  const findings: RequiredModuleFinding[] = [];
  for (const entry of required) {
    if (!composed.has(entry.moduleId)) {
      findings.push({ kind: 'not-composed', moduleId: entry.moduleId, reason: entry.reason });
      continue;
    }
    if (presence.isPresent(entry.moduleId)) continue;
    findings.push({
      kind: 'absent',
      moduleId: entry.moduleId,
      reason: entry.reason,
      // Undefined means the id is unknown to both axes, which for a module the
      // manifests declare can only mean presence was seeded without it.
      platformState: presence.presence(entry.moduleId)?.platformState ?? 'not-installed',
    });
  }
  return findings;
}

/** {@link absentRequiredModules}, as the refusal the composer makes. */
export function assertRequiredModulesPresent(
  required: readonly RequiredModule[],
  composed: ReadonlySet<string>,
  presence: RequiredModulePresence,
): void {
  const findings = absentRequiredModules(required, composed, presence);
  if (findings.length > 0) throw new RequiredModuleAbsentError(findings);
}
