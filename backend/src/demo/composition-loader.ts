/**
 * This repository's demo composition (feature 113, T212;
 * `contracts/module-demo-data-layer.md` §5.6).
 *
 * ## It is the package every instance installs, and not a file of this tree's
 *
 * Until 2026-10-01 this loader probed for `src/seeds/demo-composition.ts`, and
 * that file was the only demo composition anywhere: an instance scaffolded by
 * `endora new instance` had none, so its `demo seed` left 203 products that no
 * sales channel sold and demo administrators with no role. The composition is
 * `@endora-commerce/demo-composition` now — the same code here and in a
 * client's instance — and this repository depends on it like an instance that
 * asked for demo data does.
 *
 * ## Why it is named here rather than found
 *
 * An instance does not pass this loader at all: the platform's dispatcher finds
 * the installed package by its `"endora": { "type": "demo-composition" }`
 * declaration (`@endora-commerce/platform`'s `demo/installed-composition.ts`).
 * That discovery refuses a workspace link for the reason module discovery does
 * — a link out of `node_modules` is a checkout's member, not something an
 * instance installed — and in this repository the package *is* a workspace
 * link. So this tree says which composition it means, which is what
 * `operator-half.md` §1.1 leaves to the tree in the first place.
 *
 * ## Why there is no probe any more
 *
 * The probe existed to tell "this tree has no composition" from "it has one and
 * it is broken" without a `catch`. A dependency is not optional: a missing one
 * fails at the import, loudly, and nothing here can read it as "none".
 */
import { createDemoComposition } from '@endora-commerce/demo-composition';
import type {
  DemoCompositionInput,
  DemoCompositionLookup,
} from '@endora-commerce/platform/demo';

export async function loadDemoComposition(
  input: DemoCompositionInput,
): Promise<DemoCompositionLookup> {
  return { found: true, composition: createDemoComposition(input) };
}
