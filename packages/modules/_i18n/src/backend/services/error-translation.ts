export interface ErrorTranslationTarget {
  moduleId: string;
  /**
   * Widened from `errors.${ErrorCode}` by feature 090: a module declares codes
   * the platform's enumeration does not hold, and the key is built from the
   * code either way.
   */
  key: `errors.${string}`;
}

// ---------------------------------------------------------------------------
// The declared routing map — feature 090
// (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §4)
// ---------------------------------------------------------------------------

/**
 * One manifest, and the file it was declared in.
 *
 * Structurally what `RegisteredManifestEntry` already is, restated here rather
 * than imported: `_lifecycle` owns that type and a module may not name a file in
 * another module's directory. The `filePath` is not decoration — it is what
 * §3.1 rule 3 requires a collision report to name for **every** claimant, and
 * with 67 modules a module id alone does not tell an operator which package on
 * their disk to look at.
 */
export interface ErrorCodeDeclarationSource {
  readonly manifest: {
    readonly id: string;
    // `| undefined` explicitly, because `exactOptionalPropertyTypes` is on and
    // `ModuleManifest.errorCodes` is `T[] | undefined` rather than an absent
    // property — without it a real `RegisteredManifestEntry` is not assignable
    // to this shape at all, which is the only shape callers ever pass.
    readonly errorCodes?: readonly { readonly code: string }[] | undefined;
  };
  readonly filePath: string;
}

/** One module's claim on a code. */
export interface ErrorCodeClaim {
  readonly moduleId: string;
  readonly declaredIn: string;
}

/** A code more than one registered module declares. Nobody wins. */
export interface ErrorCodeCollision {
  readonly code: string;
  readonly claims: readonly ErrorCodeClaim[];
}

export interface ErrorTranslationTargets {
  readonly targets: Readonly<Record<string, ErrorTranslationTarget>>;
  readonly collisions: readonly ErrorCodeCollision[];
}

/**
 * Which bundle holds which code's sentence, derived from the manifests.
 *
 * The input is **every registered manifest** — core, this deployment's overlay
 * modules and every installed package — which is the set `resolvedManifestEntries()`
 * produces and `admin_roles` builds the permission catalogue from. Activation
 * and platform availability are **not** consulted, and that is a standing ruling
 * rather than an omission (`specs/082-error-code-ownership/contracts/error-code-ownership.md`
 * §1.3): a code owned by a switchable module is raised by other modules too, so
 * a switched-off `carts` must not cost `orders` its checkout sentence.
 *
 * **Collisions: nobody wins** (§3). A code more than one module declares is
 * *absent* from `targets` and present in `collisions` with every claimant named.
 * There is no tie-break — not first-wins, not last-wins, not by origin, not by
 * manifest order, not by module id — because every one of them renders one
 * raiser's condition under the other's sentence: good prose about the wrong
 * thing, with no symptom an operator or a client can detect. The envelope
 * already rules that trade at five other exits from the same hook, and the
 * answer is the same one: untranslated prose which is true beats a rendered
 * sentence that is not.
 *
 * **One derivation** (D-100): the report and the routing come out of this one
 * call, so they cannot come to disagree about which codes are contested.
 *
 * **Deterministic**: the answer does not depend on the order the manifests
 * arrive in. Claims are sorted by module id, collisions by code.
 *
 * **There is no fall-through** (§4.1). A code no registered manifest declares is
 * *absent* from `targets`: it is not routed to the platform, to `core`, or to
 * anything else, and the envelope answers the raising code's own English. That
 * is `specs/082-error-code-ownership/rulings.md` §9 (D-129) delivered — *"`core`
 * is only ever reached by being named"* — and it is what the deleted prefix
 * chain could not do, because its last line was `return 'core'`.
 *
 * **The chain and `composeErrorTranslationTargets` are gone** (feature 090
 * Phase 4). The transitional composition laid these declarations over
 * `moduleIdForErrorCode` so that the migration could be delivered one module per
 * merge request while staying answer-preserving; all eighteen owners have
 * declared, so both roots call this directly. The answer it gives for every
 * member of `ERROR_CODES` is still measured against the frozen capture in
 * `backend/test/fixtures/error-code-routing/chain-answers.ts`, which is now the
 * only record of what the chain said.
 */
export function buildErrorTranslationTargets(
  manifests: readonly ErrorCodeDeclarationSource[],
): ErrorTranslationTargets {
  const claimsByCode = new Map<string, ErrorCodeClaim[]>();
  for (const entry of manifests) {
    for (const declaration of entry.manifest.errorCodes ?? []) {
      const claims = claimsByCode.get(declaration.code);
      const claim: ErrorCodeClaim = {
        moduleId: entry.manifest.id,
        declaredIn: entry.filePath,
      };
      if (claims) claims.push(claim);
      else claimsByCode.set(declaration.code, [claim]);
    }
  }

  const targets: Record<string, ErrorTranslationTarget> = {};
  const collisions: ErrorCodeCollision[] = [];
  for (const [code, claims] of claimsByCode) {
    if (claims.length === 1) {
      targets[code] = { moduleId: claims[0]!.moduleId, key: `errors.${code}` };
      continue;
    }
    collisions.push({
      code,
      claims: [...claims].sort(
        (a, b) => a.moduleId.localeCompare(b.moduleId) || a.declaredIn.localeCompare(b.declaredIn),
      ),
    });
  }
  return { targets, collisions: collisions.sort((a, b) => a.code.localeCompare(b.code)) };
}

/** One line per claimant, in the words an operator reads on `/platform/modules`. */
export function describeErrorCodeCollisions(
  collisions: readonly ErrorCodeCollision[],
): string {
  return collisions
    .map(
      (collision) =>
        `  - "${collision.code}" is declared by ${collision.claims.length} modules and ` +
        'therefore routes to none of them; the raising code\'s own message is answered ' +
        'until one of them gives it up:\n' +
        collision.claims
          .map((claim) => `      ${claim.moduleId} (${claim.declaredIn})`)
          .join('\n'),
    )
    .join('\n');
}
