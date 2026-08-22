// Module id collisions involving an installed package (T030c, D-155.7).
//
// A module id is the platform's identity for a module: migrations are ordered
// and reverted by it, permissions and settings are namespaced by it, and the
// lifecycle registry is keyed on it. Nothing refused a second claimant on the
// path a package takes, and the consequences were not theoretical:
//
//   - `composeModules` had no id-uniqueness assertion, so both entries
//     composed. What surfaced — if anything did — was a
//     `DuplicateRegistrationError` naming the registration key and the module
//     id twice, and neither vendor. Two claimants registering disjoint names
//     collided on nothing at all.
//   - `resolvedManifestEntries` is a `Map` keyed by id: core won silently and
//     among the rest the last writer won, silently. So the manifest set carried
//     one module while the container ran two.
//   - `buildStaticRegistry` does throw the right refusal, and was reached only
//     by the `module:*` CLI scripts, each of which fed bare-core
//     `REGISTERED_MANIFESTS`. The right refusal, wired where a package could not
//     reach it. Since T036 those five read the resolved set — but they reach
//     *this* file's refusal, not that one, because the resolver keys a `Map` by
//     id and no duplicate survives to `buildStaticRegistry`. That is the better
//     of the two: this one still holds both vendors and can name them.
//
// Two vendors' `blog` packages therefore produced correctly-scoped,
// differently-stamped migration class names — no `duplicate-name`, no
// `unscoped-name` — and `orderMigrations` merged two strangers' chains into one
// contiguous block under one id. A hard uninstall of `blog` reverted both,
// because `revertMigrationsFor` filters on `moduleId` and nothing downstream
// can tell the two apart.
//
// `specs/081-per-module-migration-order/contracts/migration-identity.md` §2
// already argues its sufficiency from *"the lifecycle refuses a second module
// claiming an id"*. This file, and `kernel/lifecycle/unique-module-ids.ts`, are
// what make that sentence true.
//
// **Why the refusal is placed twice.** Discovery is the only layer that still
// holds both vendors — by `composeModules` an entry is an id, a version and a
// function — so this is where the message that names both `package.json` paths
// can be written. The composition seam is where the guarantee becomes
// structural for *any* entry source rather than a property of one loader.

/** Where a claim on a module id came from. */
export type ModuleIdClaimOrigin = 'core' | 'overlay' | 'package';

export interface ModuleIdClaim {
  readonly id: string;
  readonly origin: ModuleIdClaimOrigin;
  /**
   * The file that claims the id: `manifest.ts` for a core or overlay module,
   * the resolved `package.json` for an installed package. It is the whole
   * remedy — an operator can only act on a path.
   */
  readonly claimedBy: string;
  /** The npm package name, where there is one. */
  readonly name?: string;
}

export interface ModuleIdCollision {
  readonly id: string;
  /** Every claimant, in the order they were offered. */
  readonly claims: readonly ModuleIdClaim[];
}

/**
 * Every module id claimed by more than one source **where at least one of them
 * is an installed package**.
 *
 * The qualifier is deliberate and is not a softening. A core id and an overlay
 * id colliding is a different question with a different, shipped answer: the
 * overlay is dropped, because a deployment shadowing a module it authored is
 * what the overlay mechanism is for. A stranger claiming an id that is already
 * taken has no such reading — the operator installed something that cannot run
 * here, and the only useful answer is to say so and name both files.
 */
export function packageModuleIdCollisions(
  claims: readonly ModuleIdClaim[],
): ModuleIdCollision[] {
  const byId = new Map<string, ModuleIdClaim[]>();
  for (const claim of claims) {
    const existing = byId.get(claim.id);
    if (existing) existing.push(claim);
    else byId.set(claim.id, [claim]);
  }

  const collisions: ModuleIdCollision[] = [];
  for (const [id, claimants] of byId) {
    if (claimants.length < 2) continue;
    if (!claimants.some((claim) => claim.origin === 'package')) continue;
    collisions.push({ id, claims: claimants });
  }
  return collisions;
}

/** The refusal. A distinct type, per D-101's rule that absence refusals stay distinct. */
export class ModuleIdCollisionError extends Error {
  readonly collisions: readonly ModuleIdCollision[];

  constructor(collisions: readonly ModuleIdCollision[]) {
    super(refusalMessage(collisions));
    this.name = 'ModuleIdCollisionError';
    this.collisions = collisions;
  }
}

const ORIGIN_LABEL: Record<ModuleIdClaimOrigin, string> = {
  core: 'a core module',
  overlay: "this deployment's overlay",
  package: 'an installed package',
};

function refusalMessage(collisions: readonly ModuleIdCollision[]): string {
  const lines: string[] = [
    'This instance will not start: more than one module claims the same module id.',
    '',
  ];
  for (const collision of collisions) {
    lines.push(`  ${collision.id} — claimed by ${collision.claims.length}:`);
    for (const claim of collision.claims) {
      lines.push(
        `      ${ORIGIN_LABEL[claim.origin]}${claim.name ? ` (${claim.name})` : ''}`,
        `          ${claim.claimedBy}`,
      );
    }
    lines.push('');
  }
  lines.push(
    'A module id is the platform\'s identity for a module: migrations are ordered and reverted',
    'by it, settings and permissions are namespaced by it, and the lifecycle registry is keyed',
    'on it. Two claimants cannot be told apart afterwards — a hard uninstall of the id would',
    'revert both vendors\' migrations — so this is refused rather than resolved by picking one.',
    '',
    'remedy: `pnpm remove` one of the packages above, or ask its author to change `endora.id`.',
    'The npm package name is not the identity (D-142) and renaming it changes nothing here.',
  );
  return lines.join('\n');
}

/** {@link packageModuleIdCollisions}, as the refusal a composition root makes. */
export function assertNoPackageModuleIdCollisions(claims: readonly ModuleIdClaim[]): void {
  const collisions = packageModuleIdCollisions(claims);
  if (collisions.length > 0) throw new ModuleIdCollisionError(collisions);
}
