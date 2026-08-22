/**
 * Module id uniqueness at the composition seam (T030c, D-155.7 placement 2).
 *
 * ## The gap this closes
 *
 * `composeModules` had no id-uniqueness assertion. It composed every entry it
 * was given, and the only thing that could surface a second claimant was
 * `DuplicateRegistrationError` — which fires on the first *registration name*
 * two modules share, names that key and the module id twice, and identifies
 * neither claimant. Two modules claiming one id while registering disjoint
 * names collided on nothing and both composed, so the container ran two
 * strangers under one identity while the manifest set carried one of them.
 *
 * That mattered because the id is the identity everything downstream keys on.
 * `specs/081-per-module-migration-order/contracts/migration-identity.md` §2
 * argues that a migration class name scoped by its module is sufficient,
 * *"because module ids are unique platform-wide — the lifecycle refuses a
 * second module claiming an id"*. Until this landed, that refusal existed only
 * in `buildStaticRegistry`, reachable from the `module:*` CLI scripts, each of
 * which feeds bare-core `REGISTERED_MANIFESTS`: the right refusal, wired
 * where a package cannot reach it.
 *
 * ## Why here as well as at discovery
 *
 * `src/packages/module-id-claims.ts` refuses the same thing where the
 * `package.json` paths still exist, which is the only place a message can name
 * both vendors. This one is the structural half: it holds for **any** entry
 * source — core, overlay, package, or whatever composes next — instead of being
 * a property of one loader. By the time a list reaches the composer an entry is
 * an id, a version and a function, so this can only say *how many* claimed the
 * id, and it says where to look for who.
 *
 * ## Why it is not `assertRequiredModulesPresent`, `assertDeactivatable` or
 * `assertLockedModulesPresent`
 *
 * D-101's rule: refusals that share a subject and nothing else stay separate,
 * so a reader can tell which question they are looking at without reading the
 * others. Those three are about *absence*; this is about *two of something*.
 * It runs in the same slot as the first of them, which is the only thing they
 * share.
 */

/** An id claimed more than once, and by how many entries. */
export interface DuplicateModuleIdFinding {
  readonly id: string;
  readonly count: number;
}

/** Every repeated id, in first-seen order. */
export function duplicateModuleIds(ids: readonly string[]): DuplicateModuleIdFinding[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const findings: DuplicateModuleIdFinding[] = [];
  for (const [id, count] of counts) {
    if (count > 1) findings.push({ id, count });
  }
  return findings;
}

/** The refusal. A distinct type, per D-101's closing rule. */
export class DuplicateModuleIdError extends Error {
  readonly findings: readonly DuplicateModuleIdFinding[];

  constructor(findings: readonly DuplicateModuleIdFinding[]) {
    super(refusalMessage(findings));
    this.name = 'DuplicateModuleIdError';
    this.findings = findings;
  }
}

function refusalMessage(findings: readonly DuplicateModuleIdFinding[]): string {
  const lines: string[] = [
    'This composition will not run: more than one module entry claims the same module id.',
    '',
  ];
  for (const finding of findings) {
    lines.push(`  ${finding.id} — claimed by ${finding.count} entries in one composition`);
  }
  lines.push(
    '',
    'The module id is what migrations are ordered and reverted by, what settings and permissions',
    'are namespaced by, and what the lifecycle registry is keyed on. Two claimants cannot be told',
    'apart afterwards, so composing both would mean one hard uninstall reverting two strangers’',
    'migrations.',
    '',
    'A composer entry carries an id, a version and a function, so this cannot say which files',
    'claimed the id. Where the entries came from can: the core list is',
    '`src/composition.generated.ts`, a deployment’s overlay modules are under',
    '`src/apps/<deployment>/modules/`, and an installed package is refused earlier, by',
    '`ModuleIdCollisionError`, with both `package.json` paths in the message.',
  );
  return lines.join('\n');
}

/** {@link duplicateModuleIds}, as the refusal the composer makes. */
export function assertUniqueModuleIds(ids: readonly string[]): void {
  const findings = duplicateModuleIds(ids);
  if (findings.length > 0) throw new DuplicateModuleIdError(findings);
}
