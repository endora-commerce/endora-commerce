/**
 * Finding this instance's demo composition, or saying once that there is none
 * (feature 113, T212; `contracts/module-demo-data-layer.md` §5.6).
 *
 * *"An instance with **no** composition at all is an ordinary state, not a
 * degraded one. The runner MUST seed every present module's own rows, MUST
 * report once that no composition was found, and MUST NOT throw, warn, or write
 * one. It MUST NOT enumerate the steps it did not run: the steps are the
 * composition's, and a runner that listed them would be holding a copy of a
 * file that is not there."*
 *
 * ## Why it is a probe and then an import, and not a `catch`
 *
 * A `try` around the import with the failure read as "absent" turns a demo
 * composition with a syntax error, a bad specifier or a throwing module body
 * into a silent "this instance has none" — the fail-open shape
 * `check:port-catches` refuses one seam over, and the shape §6.4 spells out for
 * the escape hatch. So the two states are decided by two different mechanisms:
 * **is the file there** is answered by looking, and **does it load** is
 * answered by loading and by nothing else. A composition that is present and
 * broken fails the command, loudly, with its own error.
 *
 * ## Why the loader is here and not in `src/seeds/`
 *
 * It has to outlive the file it looks for. In a client's instance the
 * composition is their tree's file and may simply not exist (D-216: a client
 * scaffolding an instance for their own trading receives no demo artefact
 * unless they ask); in this repository it is `src/seeds/demo-composition.ts`.
 * A loader living beside the thing it is deciding the existence of would be a
 * static import wearing a probe's clothes.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DemoComposition } from '@endora-commerce/platform/demo';

/**
 * The specifier the composition is imported at, and the two file names that
 * specifier can land on.
 *
 * `.ts` under `tsx` and `.js` in the built tree — the same pair every
 * host-internal reach in this application straddles, written out because the
 * probe reads the filesystem and the import reads the loader's resolution.
 */
const COMPOSITION_SPECIFIER = '../seeds/demo-composition.js';
const CANDIDATE_FILES = ['../seeds/demo-composition.ts', '../seeds/demo-composition.js'];

/**
 * The one sentence §5.6 asks for. It says what is absent and what that means,
 * and enumerates nothing.
 */
export const NO_DEMO_COMPOSITION_NOTICE =
  'No demo composition was found in this instance, so only the modules above ran. ' +
  'A composition is the wiring that spans modules — which categories a menu mirrors, ' +
  'which channel sells which products — and it belongs to whoever owns the instance, ' +
  'not to the platform. An instance without one is an ordinary instance.';

export interface DemoCompositionInput {
  readonly em: EntityManager;
  readonly isPresent: (moduleId: string) => boolean;
}

/** Present and loaded, or absent with the sentence to print. Never both. */
export type DemoCompositionLookup =
  | { readonly found: true; readonly composition: DemoComposition }
  | { readonly found: false; readonly notice: string };

/** The shape a composition module exports. */
interface CompositionModule {
  createDemoComposition(input: DemoCompositionInput): DemoComposition;
}

export async function loadDemoComposition(
  input: DemoCompositionInput,
): Promise<DemoCompositionLookup> {
  const present = CANDIDATE_FILES.some((candidate) =>
    existsSync(fileURLToPath(new URL(candidate, import.meta.url))),
  );
  if (!present) return { found: false, notice: NO_DEMO_COMPOSITION_NOTICE };
  const module = (await import(COMPOSITION_SPECIFIER)) as CompositionModule;
  return { found: true, composition: module.createDemoComposition(input) };
}
