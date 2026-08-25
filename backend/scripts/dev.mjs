/**
 * The development loop, compiled (feature 080, D-165 step G).
 *
 *   node scripts/dev.mjs src/index.ts     # the API, what `pnpm run dev` runs
 *   node scripts/dev.mjs src/worker.ts    # the standalone worker
 *
 * One esbuild context in watch mode over `src/`, and `node --watch` over what it
 * writes. That is the whole shape, and it is deliberately the whole shape:
 * D-165.4 looked at the alternative — a 2027-line `dev.mjs` with four watch
 * scopes, an inotify-limit fixer and a memory sampler — and recorded that it is
 * what a team builds after watching 25 esbuild contexts on a laptop. We watch
 * one tree.
 *
 * ## What it replaced, and what it measured
 *
 * `tsx watch --env-file-if-exists=.env src/index.ts`. `tsx watch` restarts the
 * process **and** re-transpiles on demand; a prebuilt tree only restarts.
 * Measured on one machine against a live dev database, editing a real module
 * source (`modules/orders/services/order-service.ts`, 82 KB):
 *
 *   tsx watch      25.9 s / 12.6 s / (a third edit never came back)
 *   this loop      0.05 s incremental transpile + 5.3–5.9 s boot
 *
 * The whole-tree transpile is 0.4 s for 1334 files, so even a cold start of this
 * loop is inside one `tsx watch` restart.
 *
 * ## The two things it does differently, stated rather than discovered
 *
 * **Packages resolve at their `dist`, as production resolves them, and editing
 * one is outside this loop.** `tsconfig.build.json` clears the `paths` block, so
 * `@endora-commerce/contracts` is read from `packages/contracts/dist` and not
 * from its source; this context watches `src/` and nothing else. `tsx` honoured
 * `paths` for the five packages that have an entry and read their *source* —
 * measured: editing `packages/contracts/src/index.ts` restarted `tsx watch` in
 * 24.9 s with no package build. Here that edit is
 * `pnpm --filter @endora-commerce/contracts run build` (5.4 s) and `Ctrl-C`,
 * for about the same wall clock.
 *
 * That is a real ergonomic loss for those five and it is taken deliberately,
 * because the alternative it replaces was worse than it looked: under `tsx` the
 * dev process ran a package's **source** while every test, every image and
 * `node dist/` ran its **`dist`**, which is the dev/production divergence this
 * whole feature exists to close. It is also not the loss it appears to be for
 * the rest — `@endora-commerce/platform` and every module package have no
 * `paths` entry by design, so `tsx watch` never picked those up either
 * (AGENTS.md says so: "it watches `backend/`, and the platform is not under
 * it").
 *
 * **A new source file needs a restart of this loop too.** The entry-point glob
 * is expanded when the context is created. Editing files is the loop; adding one
 * is `Ctrl-C`.
 *
 * ## Assets, and why they are entry points
 *
 * `tsc` compiles `.ts` and copies nothing else, so a built tree holds every
 * module's code and none of its data — the silence D-165.3 reproduced, where an
 * absent bundles directory reads as "this module ships no translatable strings"
 * and the boot reports `installed=0 failed=0`. Here the assets are entry points
 * with esbuild's `copy` loader, so a translation bundle edited during a session
 * is copied by the same watch that transpiles, rather than needing this loop
 * restarted. Nothing under `src/` imports a `.json`, which is what makes the
 * loader safe to set globally (an import would become a URL string).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const BACKEND_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const entry = process.argv[2];
if (entry === undefined || !entry.startsWith('src/') || !entry.endsWith('.ts')) {
  console.error(
    'usage: node scripts/dev.mjs <src/…​.ts>\n' +
      'The source entry point is named rather than derived: it is what this loop compiles ' +
      'and runs, and naming it here is also what keeps `check:entry-scope` seeing it — half ' +
      "that check's population is the `src/**.ts` paths a package script runs.",
  );
  process.exit(2);
}
const sourceEntry = resolve(BACKEND_ROOT, entry);
if (!existsSync(sourceEntry)) {
  console.error(`[dev] ${entry} does not exist.`);
  process.exit(2);
}
const builtEntry = join(BACKEND_ROOT, 'dist', entry.slice('src/'.length).replace(/\.ts$/, '.js'));

const envFile = join(BACKEND_ROOT, '.env');
/** The application process, replaced on every successful rebuild. */
let child = null;
/** Set while a restart is in flight, so the child's exit is not the loop's exit. */
let restarting = false;

function startChild() {
  child = spawn(
    process.execPath,
    [...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), builtEntry],
    { cwd: BACKEND_ROOT, stdio: 'inherit' },
  );
  child.on('exit', (code) => {
    if (restarting) return;
    void context.dispose().then(() => process.exit(code ?? 0));
  });
}

async function restart() {
  if (child === null) {
    startChild();
    return;
  }
  restarting = true;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  await exited;
  restarting = false;
  startChild();
}

const context = await esbuild.context({
  absWorkingDir: BACKEND_ROOT,
  // A glob rather than a walk: esbuild owns the expansion, and the second and
  // third patterns are the runtime assets — `RUNTIME_ASSET_EXTENSIONS` in
  // `scripts/lib/runtime-assets.ts` is the build's list and this is its twin.
  entryPoints: ['src/**/*.ts', 'src/**/*.json', 'src/**/*.txt'],
  outdir: 'dist',
  outbase: 'src',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  // The production build's configuration, so this loop resolves what production
  // resolves. Everything decorated in this tree is a MikroORM entity, whose
  // decorators are legacy; `experimentalDecorators` travels from here.
  tsconfig: 'tsconfig.build.json',
  loader: { '.json': 'copy', '.txt': 'copy' },
  plugins: [
    {
      // The restart, driven by the build that produced the change.
      //
      // D-165.4 describes this loop as "`node --watch` plus one esbuild
      // context", and `node --watch` was the first spelling. It is not the one
      // that shipped, for two measured reasons and one structural one.
      //
      // **Node 26 cannot run this application under `--watch`.** `node
      // dist/index.js` boots; `node --watch dist/index.js` dies in pino's
      // `thread-stream` with `Error: this should not happen: undefined` before
      // the first log line. Node 22.20 — the version `.nvmrc`, `engines` and
      // every image name — is unaffected, so this is out of the supported
      // range; but the ambient `node` on a developer machine is whatever is
      // installed, and a dev loop that dies on the maintainer's own `node -v`
      // is not a dev loop.
      //
      // **`--watch` and `--env-file-if-exists` do not compose.** Under
      // `--watch`, Node 22.20 hands the *declared* env path to the file watcher
      // without asking whether the tolerant loader skipped it, so a checkout
      // with no `backend/.env` dies on `ENOENT … watch '…/backend/.env'` —
      // after printing ".env not found. Continuing without it." twice.
      //
      // And structurally: `--watch` restarts on a file write, this restarts on a
      // *build*, so a rebuild that touches nine files is one restart rather than
      // a race against esbuild's own writes. A build with errors keeps the last
      // working process alive, which `tsx watch` does not.
      name: 'restart-on-rebuild',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error('[dev] build failed — the previous process is still running.');
            return;
          }
          if (child !== null) void restart();
        });
      },
    },
  ],
});

const started = Date.now();
await context.rebuild();
console.log(
  `[dev] compiled src/ in ${Date.now() - started} ms — watching src/ only. ` +
    'A change under packages/ needs that package built and this loop restarted.',
);
await context.watch();
startChild();

const stop = (signal) => {
  restarting = true;
  child?.kill(signal);
  void context.dispose().then(() => process.exit(0));
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
