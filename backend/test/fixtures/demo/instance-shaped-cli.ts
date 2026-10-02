/**
 * The operator CLI as a scaffolded instance wires it, minus the one thing an
 * instance cannot have in this checkout.
 *
 * `endora new instance` renders a `backend/src/cli.ts` that passes
 * `runCli({ deploymentRoot })` and nothing else — in particular **no
 * `demoComposition`** — so the dispatcher's own default decides whether the
 * demo shop's wiring runs. That default is the subject of
 * `test/integration/demo/demo-instance-shape.test.ts`, and this entry point is
 * the instance's `cli.ts` with exactly that property.
 *
 * What it does supply, and why: an instance's default manifest resolution and
 * composition read the module packages it **installed**, and every module
 * package in this checkout is a workspace link, which discovery refuses by
 * design. So the module set and the composition are this repository's own —
 * the same two suppliers `src/cli.ts` passes — and the demo composition is
 * left to the dispatcher, which is the only difference the test is about.
 */
import { runCli } from '@endora-commerce/platform/cli';

import { composeApp } from '../../../src/composition.js';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { deploymentRoot } from '../../../src/overlay/overlay-roots.js';

await runCli({
  deploymentRoot: deploymentRoot(),
  resolveEntries: resolvedManifestEntries,
  compose: async () => {
    // `src/cli.ts`' reason: keep the BullMQ scheduler write off a one-shot run.
    process.env['BACKEND_ROLE'] = 'api';
    return await composeApp({ deploymentRoot: deploymentRoot() });
  },
});
