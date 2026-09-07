/**
 * Reading a tree's own environment-input declaration
 * (`environment-inputs.md` §R2.3).
 *
 * ## Why this loads the file rather than importing a package
 *
 * The declaration a scaffolding command resolves against is the **declaration
 * of the tree being written** — the reference storefront's here, a client's own
 * copy of it once they have one. Under D-195 that tree is a repository the
 * client owns outright: its declaration travels in the copy and is edited there,
 * so it cannot be a constant compiled into this program. A list in the CLI would
 * be a derived fact written down (D-100) that could never see a tree a client
 * changed.
 *
 * The declaration is `.mjs` for the reason `storefront/lib/env.mjs` is: it has
 * to be readable by a plain Node process before the tree it describes has been
 * installed or built. `import()` of a file URL is therefore all that is needed,
 * and there is no compiler in the path.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { EnvironmentInputsSchema, type EnvironmentInput } from '@endora-commerce/contracts';

/** The file every application-level declaration is named, in every tree. */
export const DECLARATION_FILE = 'environment-inputs.mjs';

/** Raised when a tree's declaration is absent or is not one. Exit 2's shape. */
export class DeclarationLoadError extends Error {
  override readonly name = 'DeclarationLoadError';
}

/**
 * The declaration a tree ships, or a refusal.
 *
 * **Absent is a refusal, never "this tree needs nothing"**, which is the failure
 * `manifest-locations.ts` was written to end one surface over: a command that
 * read a missing declaration as an empty one would write a `.env` holding
 * nothing, print `total=0 defaulted=0` — perfectly true, and about a population
 * it never found — and hand its author a storefront that refuses to build.
 */
export async function loadTreeDeclaration(
  treeDir: string,
  exportName: string,
): Promise<readonly EnvironmentInput[]> {
  const path = join(treeDir, DECLARATION_FILE);
  if (!existsSync(path)) {
    throw new DeclarationLoadError(
      `${path} is not there, so this run cannot say what the tree needs from its ` +
        `environment. A declaration that is absent is not a tree with no requirements.`,
    );
  }
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  } catch (error: unknown) {
    throw new DeclarationLoadError(
      `${path} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = EnvironmentInputsSchema.safeParse(loaded[exportName]);
  if (!parsed.success) {
    throw new DeclarationLoadError(
      `${path} does not export \`${exportName}\` as an environment-input declaration — ` +
        parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
    );
  }
  if (parsed.data.length === 0) {
    throw new DeclarationLoadError(`${path} declares no input at all`);
  }
  return parsed.data;
}
