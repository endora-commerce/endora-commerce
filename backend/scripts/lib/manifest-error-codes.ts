/**
 * "Which module declares which error code?" — read off the generated manifest
 * index, for a check that has no container to ask (feature 090, Phase 4).
 *
 * `check:error-translations` used to read `ERROR_TRANSLATION_KEYS`, a static
 * table inside `_i18n` built by a prefix chain over the closed `ERROR_CODES`
 * enumeration. Phase 4 deleted that chain: routing is now the modules' own
 * `errorCodes` declarations, composed by `buildErrorTranslationTargets`. So the
 * check's input has to be the declarations, and the population it reads them
 * from is this repository's committed manifests — R1's population in
 * `specs/090-module-owned-error-codes/contracts/error-translation-population.md`
 * §1. An overlay module's and an installed package's declarations are R3's, at
 * boot, because no static reader can see them.
 *
 * **Same reader, same import as `switchable-modules.ts`.** Both load
 * `DISCOVERED_MANIFESTS` out of the index `lib/module-roots.ts` located, so the
 * two derivations cannot come to disagree about which modules exist. The path is
 * given and never built, for the reason recorded there: a layout move must not
 * break the reader every population floor rests on.
 *
 * **An entry with no `manifestPath` is refused, never defaulted.** The path is
 * what a collision report names for each claimant, and with 66 modules a module
 * id alone does not tell an operator which package on their disk to look at
 * (`contracts/error-code-declaration.md` §3.1 rule 3). The registry refuses the
 * same thing for the same reason.
 */
import { pathToFileURL } from 'node:url';

import { ManifestIndexUnreadableError } from './switchable-modules.js';

export { ManifestIndexUnreadableError };

/**
 * One module's error-code declaration, in the shape
 * `buildErrorTranslationTargets` takes.
 *
 * Structurally what `ErrorCodeDeclarationSource` is — restated rather than
 * imported so this loader stays a plain reader of a generated artefact, exactly
 * as `ManifestActivationInput` restates the two fields switchability needs.
 */
export interface ManifestErrorCodeDeclaration {
  readonly manifest: {
    readonly id: string;
    readonly errorCodes?: readonly { readonly code: string }[] | undefined;
  };
  readonly filePath: string;
}

interface IndexEntry {
  readonly id: string;
  readonly manifestPath?: string;
  readonly manifest: { readonly errorCodes?: readonly { readonly code: string }[] };
}

/**
 * Every registered module's error-code declaration, including the modules that
 * declare none.
 *
 * The empty ones are kept deliberately: the check's floor asks *which* modules
 * declare a code, and computing that from a list the loader has already filtered
 * would make "declares nothing" and "was not read" the same answer.
 *
 * Throws `ManifestIndexUnreadableError` when the index is missing or registers
 * no module; a caller turns that into exit 2, never into a pass.
 */
export async function loadManifestErrorCodes(
  indexPath: string,
): Promise<readonly ManifestErrorCodeDeclaration[]> {
  let entries: readonly IndexEntry[];
  try {
    const loaded = (await import(pathToFileURL(indexPath).href)) as {
      DISCOVERED_MANIFESTS?: readonly IndexEntry[];
    };
    entries = loaded.DISCOVERED_MANIFESTS ?? [];
  } catch (error: unknown) {
    throw new ManifestIndexUnreadableError(
      `${indexPath} could not be imported: ${String(error)}`,
    );
  }
  if (entries.length === 0) {
    throw new ManifestIndexUnreadableError(`${indexPath} declared no modules`);
  }
  return entries.map((entry) => {
    if (typeof entry.manifestPath !== 'string' || entry.manifestPath.length === 0) {
      throw new ManifestIndexUnreadableError(
        `${indexPath} entry '${entry.id}' carries no manifestPath — a collision report has ` +
          'to name the file each claimant declared in, and there is no convention left to ' +
          'guess one from. Regenerate it: pnpm --filter backend run composer:generate',
      );
    }
    const errorCodes = entry.manifest.errorCodes;
    return {
      manifest: {
        id: entry.id,
        ...(errorCodes === undefined ? {} : { errorCodes }),
      },
      filePath: entry.manifestPath,
    };
  });
}
