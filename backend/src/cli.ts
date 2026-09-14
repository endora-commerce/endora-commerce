/**
 * `endora` — this repository's operator CLI entry point (feature 080, T042b /
 * D-160.9, D-157.8; `specs/123-oss-install-experience/` G2).
 *
 * ## What changed, and why the invocation inverted
 *
 * A module's operator command used to be a script that bootstrapped the host:
 * it called `initOrm()`, hand-built the services it needed and exited. Three
 * things were wrong with that, and only the first is a matter of taste.
 *
 *  1. A hand-built service is not the composition's service, so a **deployment
 *     decoration** over it never reached the command — a client not getting an
 *     override they paid for.
 *  2. A script with no container has nothing to resolve another module's port
 *     from, so it imported that module's service class instead.
 *  3. A **package** cannot do it at all. A file under `node_modules` can name
 *     no specifier that resolves to this instance's `src/composition.ts`.
 *
 * So the host composes once and calls the module, which is exactly how install
 * hooks already work (D-46) and one-to-one with Magento 2's
 * `CommandListInterface`.
 *
 * ## Why this file is now four suppliers and nothing else
 *
 * The dispatch — argv, the demo verbs, the system scope over the composed
 * container, the exit code — is `@endora-commerce/platform/cli`'s since G2,
 * because a scaffolded instance needs the same one and `endora new instance`
 * had been reporting this path as an omission rather than rendering ~170 lines
 * of it into a client's tree (R7.1: *"a client's copy of it is a copy that
 * diverges the first time we correct ours"*).
 *
 * What is left is what genuinely names a path in the tree that installs the
 * platform, which is `operator-half.md` §1.1's whole partition:
 *
 *  - `resolvedManifestEntries` — this build's **generated** core index;
 *  - `composeApp` — this repository's own composition, with its generated
 *    module list;
 *  - `loadDemoComposition` — the probe for `src/seeds/demo-composition.ts`;
 *  - `deploymentRoot()` — the one directory holding `apps/`.
 *
 * An instance supplies only the last of those and takes the defaults, which is
 * why the file `endora new instance` renders is five lines rather than this one
 * copied.
 *
 * ## Usage
 *
 *   pnpm --filter backend run cli -- --list
 *   pnpm --filter backend run cli -- <module id> <command> [args…]
 *
 * The named aliases in `backend/package.json` — `search:reindex`,
 * `admin:create`, `i18n:reload` and the rest — are thin wrappers over this.
 *
 * ## What this is not
 *
 * It is not the path a `module:*` command takes, and must never become one.
 * `module:install|uninstall|enable|disable|status` operate **on** the platform
 * rather than with it, and composing runs `reconcileExistingModules`, which
 * inserts `state='installed'` for every shipped manifest with no row — so a
 * composing `module:install X` would find `X` already installed and return
 * `already-installed`, applying no migration and running no install hook, at
 * exit code 0 (D-157.2/.4). Those five stay hand-built scripts.
 */
import { runCli } from '@endora-commerce/platform/cli';

import { composeApp } from './composition.js';
import { loadDemoComposition } from './demo/composition-loader.js';
import { resolvedManifestEntries } from './lifecycle/registered-manifests.js';
import { deploymentRoot } from './overlay/overlay-roots.js';

await runCli({
  deploymentRoot: deploymentRoot(),
  // How an operator reaches this dispatcher **here**. A scaffolded instance's
  // is `pnpm run cli`, which is the default; this repository's members are
  // filtered, and the usage text has to print the line that actually works in
  // the tree it was printed from (defect F-1, feature 125 T1-F).
  program: 'pnpm --filter backend run cli',
  resolveEntries: resolvedManifestEntries,
  compose: async () => {
    // `BACKEND_ROLE` before the composition, not after: `runWorkers` is
    // `BACKEND_ROLE !== 'api'`, and it decides whether `product_feeds`' boot
    // hook re-asserts its BullMQ Job Schedulers — the single Redis write a
    // composition performs, kept off a one-shot command's critical path
    // (D-157.2).
    process.env['BACKEND_ROLE'] = 'api';
    return await composeApp({ deploymentRoot: deploymentRoot() });
  },
  demoComposition: loadDemoComposition,
});
