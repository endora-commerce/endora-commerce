/**
 * A deployment's divergence declaration — the **shape half**
 * (`specs/115-lifecycle-container-move/`, D115-3;
 * `contracts/operator-half.md` §4).
 *
 * What a deployment declares about how it means to differ from core. Its first
 * content is the declared escape from D-101's boot refusal: a deployment may
 * ship fewer modules than its manifests declare — that is the reduced
 * deployment feature 071's packaging split exists to make possible — and what it
 * may not do is arrive at that state silently. The owner's E1 ruling is that
 * *"someone deliberately assembling a reduced deployment must declare that they
 * know"*.
 *
 * The declaration is a **committed, reviewed, per-deployment file**, not a flag.
 * D-69 refused a `--force` on the orchestrator's withdrawal guard on the ground
 * that a flag is weighed once, at 2 a.m., by one person; the same reasoning
 * points the same way here. A committed entry appears in the merge request that
 * assembles the deployment, where somebody who is not mid-incident reads it.
 *
 * No file, or a declaration with nothing in it, means "this deployment differs
 * from core in no way it has to declare" — the two states are deliberately the
 * same answer, which is what makes the split below load-bearing rather than
 * tidy.
 *
 * ## Why only two functions are here
 *
 * `divergence.ts` was one file with three things in it: this parser, a path
 * derivation and a loader. The rule that splits them is `contracts/operator-half.md`
 * §1's — *a file belongs to `@endora-commerce/platform` unless it names a path in
 * the tree that installs the platform* — and these two name none. They are pure
 * over {@link DeploymentDivergenceDeclarationSchema}: no disk, no environment,
 * no deployment. `path` is a caller-supplied string that appears in a refusal
 * and is never composed, resolved or read.
 *
 * **The other half may not follow them here, and that is measured rather than
 * preferred.** The loader derives its root from its own `import.meta.url`, and
 * that chain is correct for its location and for no other: it was one `dirname`
 * too high once, so it composed `backend/apps/<d>/divergence.ts`, `existsSync`
 * said no, and **every deployment read as declaring nothing** — D-101's declared
 * escape had never worked, in production or under `tsx`, and nothing could see
 * it because an absent file and an empty declaration are the same answer. Three
 * `dirname`s from a file in this directory's neighbourhood give
 * `packages/platform/src` or `packages/platform`, so a wholesale move reproduces
 * that state exactly. The locator stays in the tree that owns `apps/`, and the
 * platform receives the *value* — which is the seam it already had:
 * `kernel/compose.ts` takes the declaration as a field of `ComposeModulesOptions`
 * and has never called the loader.
 *
 * @see `backend/src/overlay/divergence-loader.ts` — the half that reads the disk.
 */

import {
  DeploymentDivergenceDeclarationSchema,
  type DeploymentDivergenceDeclaration,
} from '@endora-commerce/contracts';

/** A declaration that declares nothing — an absent file's answer, as data. */
export function emptyDivergenceDeclaration(): DeploymentDivergenceDeclaration {
  return { omittedModules: [], decorationOrder: {}, reasons: {} };
}

/**
 * A declaration is only a declaration if each entry carries its reason.
 *
 * Exported and pure so the shape rules have a proof that does not need a
 * deployment on disk: a fixture enters here as the raw exported value, which is
 * the top of this analysis rather than something the loader already computed.
 *
 * A field left out means *none of these*, which is the reading an absent file
 * already gets; a field that is present and malformed is refused, naming the
 * deployment's own file. An **array** is refused with the shape it should have
 * had, because that is what every declaration in the tree looked like before
 * D-205 and a client copying an older one deserves the sentence rather than
 * `expected object, received array`.
 *
 * @param path the declaration's own location, as the caller wishes to name it
 *   to its reader. It is prose in a refusal and nothing else — this function
 *   neither composes it nor reads it, which is what lets the platform hold the
 *   shape rule while the tree that owns `apps/` holds the layout.
 */
export function parseDivergenceDeclaration(
  value: unknown,
  path: string,
): DeploymentDivergenceDeclaration {
  if (Array.isArray(value)) {
    throw new Error(
      `${path} must export \`divergence\` as an object — ` +
        '{ omittedModules, decorationOrder, reasons }. It was an array, which is the shape ' +
        'the declaration had while it carried omissions and nothing else (D-205); the ' +
        'omissions move into `omittedModules` unchanged.',
    );
  }
  const parsed = DeploymentDivergenceDeclarationSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(declaration)'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `${path} is not a declaration — ${detail}. An omission says which module this ` +
        'deployment does not ship and what it does instead; the sentence is the review.',
    );
  }
  return parsed.data;
}
