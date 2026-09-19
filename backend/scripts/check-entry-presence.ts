/**
 * CI check — an entry point with no caller **decides** presence before it works
 * (issue #126; Constitution XVII).
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/entry-presence.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). What stays here is this repository's population, its
 * module-population floor, its locked-owner derivation — and the two **ledgers**,
 * which are entries about *these* modules and belong nowhere else. They are also
 * what `check:lock-claims` reads `backend/scripts/check-*.ts` for, so moving them
 * into the package would take them out of that check's population silently.
 *
 * Routes are gated at the `ctx.routes` seam, workers at `defineModuleWorker`,
 * subscriptions at `ctx.subscribe` — and each of those seams has a static check.
 * A timer a module starts in its own plugin body had none: `defineModuleRoutes`
 * gates *requests* through an `onRequest` hook, and a plugin body is not a
 * request, so it runs at boot whatever the module's effective state and the
 * callback keeps firing every five minutes after an operator switches the module
 * off. In `price_lists` that meant price lists went on activating and expiring on
 * a timer — it changed what customers are charged, not merely what a log said.
 *
 * The rule this enforces is the one in `AGENTS.md`, "Module enable/disable",
 * item 3: **where nothing can catch the throw, presence is decided before the
 * work, not caught after it.** A timer callback has nowhere to throw *to*, so a
 * `ModuleDisabledError` raised inside it is either swallowed by a `catch` meant
 * for transient failures or it takes out the tick. The callback therefore asks
 * `effectiveState.isPresent('<own module>')` and returns — first, and **outside**
 * the `try`, so a genuine failure and a switched-off module do not collapse into
 * one silent no-op.
 *
 * ## What this check can see
 *
 * In a module's own sources — core under `src/modules`, overlay under `src/apps`:
 *
 *   1. `setInterval(...)` — a repeating entry point, always;
 *   2. a **self-rescheduling** `setTimeout(...)`: one whose callback re-arms a
 *      timer itself, or calls back into the function that armed this one. That
 *      is `search`'s reindex tick, and it is the same entry point wearing a
 *      different constructor;
 *   3. `process.on('SIGTERM' | 'beforeExit' | 'uncaughtException' | …, …)` — the
 *      other shape with no caller to answer. The tree has none today; it is here
 *      because the rule names it and a check that waits for the first site to
 *      appear is a check that arrives after it;
 *   4. `ctx.onBoot(...)` in a **switchable** module — the fourth construct, and
 *      the reason this check is no longer named after timers (issue #146, D-68).
 *
 * Shapes 1 and 2 come from `lib/repeating-timers.ts`, which `check-entry-scope`
 * reads too (issue #128): that check classified interval entry points by
 * grepping for `setInterval(`, so the reindex loop was outside its population
 * and its unchanging count read as coverage. One recognizer, two rules — this
 * one asks whether the callback decides presence, that one whether the file
 * opens a scope. Shape 3 stays here: it has no caller to answer either, but it
 * starts no repeating execution, so it is not the shape the other check needs.
 *
 * ## Boot hooks, and why "add a probe at the top" is the wrong advice for some
 *
 * `runBootHooks` wraps every hook, attributes the failure to the module and
 * **re-throws** as `ModuleCompositionError`, which `index.ts` turns into
 * `process.exit(1)`. It does not catch, and it does not consult presence — so
 * "should this hook run for an absent module" is a decision per hook, not one
 * kernel decision, and it splits two ways (D-67/D-68):
 *
 *   - a hook that **does work** — a reconcile, a seed, a Redis or Postgres
 *     write — owes the probe a timer callback owes;
 *   - a hook that **contributes** an inert descriptor to another module's
 *     registry must **not** probe, because the host filters by contributor at
 *     enumeration and a probe would make runtime activation require a restart.
 *
 * A hook that does **both** is not repaired by a probe at all: probing it stops
 * the contribution too. `blog` and `cms` each registered an asset-reference
 * scanner beside their seed/reconcile work, and a single probe there would have
 * let an operator delete an asset a switched-off module's rows still embed —
 * data damage discovered at reactivation. Such a hook is reported as
 * `mixed-boot-hook`, with a remedy that says **split it first**; that is
 * deliberate, because two of the five working hooks in the tree were mixed and a
 * check whose only advice is "probe the top" teaches the wrong repair on 40% of
 * what it finds. `product_feeds/backend.ts` ships the split shape.
 *
 * "Does work" is recognised syntactically, the way the timer shapes are: an
 * `await` in the hook body, or a call on a receiver bound to the module's own
 * `emFactory` / `redis` / `.handle`. A body that only calls `register(…)` /
 * `push(…)` is a contribution and passes silently — which is what keeps the
 * ledger small, since ~20 of the tree's 27 hooks are contributions.
 *
 * A module whose manifest declares `activation.nonDeactivatable` is out of the
 * population: no **undeclared** absence puts its hooks in a deployment that does
 * not have it — the orchestrator refuses every withdrawal, and a composition
 * that omits the module refuses to boot (D-101). A deployment that declared the
 * omission ships neither the module nor its hooks, so there is still nothing
 * here to run. That derivation is shared with `check-port-catches`' `OWNER
 * LOCKED` through `lib/switchable-modules.ts`, so withdrawing a lock re-reds
 * both checks in the same run.
 *
 * ## What it cannot see, deliberately
 *
 *   - **A one-shot `setTimeout` inside an operation that already has a caller** —
 *     an `AbortController` deadline, a sleep between retries. Its throw has
 *     somewhere to go, and the tree holds ~20 of them; flagging those would drown
 *     the two sites that matter.
 *   - **A synchronous write reached through an imported helper**, and **a hook
 *     that awaits nothing**. Both read as contributions here. The analysis is
 *     syntactic and single-file: `seedThings(emFactory)` with no `await` and no
 *     receiver of its own is indistinguishable from `registerThings(registry)`.
 *   - **A timer reached through a helper in another file**, or one whose callback
 *     is an identifier this check cannot bind to a function in the same file. The
 *     analysis is single-file and syntactic; a scheduler abstracted behind an
 *     imported helper would pass unseen. If that shape ever arrives, the check
 *     has to grow — it will not fail loudly on its own.
 *   - **"first" in "first, and outside the try".** What is enforced is *outside
 *     the try*: a presence check nested in a `try` is reported. Ordering among
 *     the statements before it is not read.
 *
 * The kernel is out of scope for the same reason as in `check-subscribe-seam`: it
 * composes before any module and has no effective state to gate on.
 *
 * Usage: `tsx scripts/check-entry-presence.ts [--list]`
 * Exit 0 = every uncatchable entry point decides presence (or is ledgered);
 * exit 1 = at least one does not, or a ledger entry is stale;
 * exit 2 = nothing was read — no sources, or a manifest index that would have
 *          made every module look switchable. A vacuous pass is not a pass.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  checkEntryPresence,
  collectPresenceFiles,
  keyOf,
  remedyFor,
} from '@endora-commerce/cli/rules/entry-presence.js';
import { loadLockedOwners } from './lib/switchable-modules.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/entry-presence.js';

/**
 * Uncatchable entry points that may stay ungated, with the reason and the
 * question that would retire the entry.
 *
 * Keyed `<path under src/>:<scheduler>:<construct>` rather than by line, so
 * moving code inside a file does not invalidate an entry and re-opening the hole
 * does not silently inherit one. **Two-way**, in the idiom of
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`: an unledgered site fails the build, and a ledger
 * entry that no longer describes one fails it too.
 *
 * Unlike that ledger this one is not empty and is not expected to reach empty.
 * An entry here is a timer that must keep running while its module is off, and a
 * reason has to say why that is *correct* rather than why nobody has fixed it.
 */
export const TIMERS_WITHOUT_PRESENCE: Readonly<Record<string, string>> = {
  'packages/platform/src/lifecycle/services/lock.ts:acquireLifecycleLock:setInterval':
    'The lease heartbeat belongs to an in-flight lifecycle command that already holds the ' +
    'lock, and it stops when that command releases it. `_lifecycle` is non-deactivatable, so ' +
    'there is no state in which the gate would close — and asking the subsystem that resolves ' +
    "every module's presence whether it is present, from inside the lock that serialises " +
    'enable/disable, is circular. Retire this entry if a lease ever outlives the command that ' +
    'took it.',
};

/**
 * Boot hooks that do work and may keep doing it while their module is off, with
 * the reason.
 *
 * Same key, same two-way rule and the same expectation as
 * {@link TIMERS_WITHOUT_PRESENCE}: this ledger is **not** expected to empty. An
 * entry says why a hook is *right* to run while its module is absent — which is
 * also how a contribution the syntax cannot tell from work gets recorded rather
 * than "fixed" with a probe that would break it.
 *
 * A hook reported as `mixed-boot-hook` may be ledgered too, but think twice: the
 * repair for a mixed hook is two hooks, and it is cheap. An entry here for a
 * mixed hook is a claim that the contribution beside the work is fine to lose
 * while the module is off.
 */
export const BOOT_HOOKS_WITHOUT_PRESENCE: Readonly<Record<string, string>> = {
  'packages/modules/invoices/src/backend/index.ts:onBoot#3:ctx.onBoot':
    'Feature 078, D-95.3. The hook pins the system-default sales channel to its pre-D-95 ' +
    'numbering pattern, once, and then reports colliding patterns. It is a one-time migration ' +
    "of this module's own configuration, and activation is reversible where a migration is " +
    'not: probing presence means a deployment that happened to have `invoices` switched off ' +
    'during the upgrade gets the new `{channel}` default applied to its first channel instead, ' +
    'and its invoice numbers change shape. The write is idempotent and writes at most three ' +
    'rows, so a boot with the module off costs nothing and leaves the operator ' +
    'exactly the numbers they had. Retire this entry if the pin ever stops being one-time.',
};

/** Both ledgers as one map — the keys carry their own construct, so they cannot collide. */
export const ENTRY_PRESENCE_LEDGER: Readonly<Record<string, string>> = {
  ...TIMERS_WITHOUT_PRESENCE,
  ...BOOT_HOOKS_WITHOUT_PRESENCE,
};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a).
  const layout = await requireModuleLayout('[entry-presence]');
  const files = collectPresenceFiles(layout.sourceRoots);
  // The locked-owner read below refuses a tree whose index went missing. It
  // does not refuse a **partial** move — index regenerated, half the modules
  // elsewhere — where the timers and boot hooks in the modules that left are
  // simply never classified and the run reports on what stayed (issue #215).
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[entry-presence]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  // Which modules an operator can switch off, read from their manifests at check
  // time (D-63's derivation, shared with `check-port-catches`). An unreadable
  // index would make every module look switchable — a *wider* population, but
  // one derived from nothing, so it exits 2 rather than reporting either colour.
  let locked: ReadonlySet<string>;
  try {
    locked = await loadLockedOwners(layout.manifestIndexPath);
  } catch (err: unknown) {
    console.error(
      `[entry-presence] the module manifests could not be read (${String(err)}) — ` +
        'refusing to classify boot hooks against a set derived from nothing',
    );
    process.exit(2);
    return;
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));
  }

  const input = { sources, lockedModules: locked, hostResidentModules: layout.hostResidentModules };
  // The ledger is passed, never defaulted: a host states which exemptions it is
  // judging against, and `ENTRY_PRESENCE_LEDGER` is this repository's.
  const result = checkEntryPresence(input, ENTRY_PRESENCE_LEDGER);

  if (listMode) {
    for (const entry of [...result.violations, ...result.ledgered]) {
      const tag = ENTRY_PRESENCE_LEDGER[keyOf(entry)] !== undefined ? 'LEDGERED' : 'UNGATED ';
      console.log(
        `${tag} ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler} — ${entry.finding}`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). No `sites=`: this check
  // records the entry points that fail the rule and never counts the ones that
  // pass it, so there is no examined-site number to print without walking the
  // tree twice — ledgered in `test/helpers/check-read-sizes.ts`.
  reportReadSize({ prefix: '[entry-presence]', files: sources.size, coverage: [coverage] });
  console.log(
    `[entry-presence] uncatchable entry points not deciding presence=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(ENTRY_PRESENCE_LEDGER).length} ` +
      `locked-modules=${locked.size} stale=${result.stale.length}`,
  );

  const mixed = result.violations.filter((entry) => entry.finding === 'mixed-boot-hook');
  const plain = result.violations.filter((entry) => entry.finding !== 'mixed-boot-hook');

  if (plain.length > 0) {
    console.error(
      '\nA module starts work nothing can catch a throw from, and never asks whether the\n' +
        'module is present (Constitution XVII). A timer callback keeps firing and a boot hook\n' +
        'keeps running with the module switched off, so both go on writing while an operator\n' +
        "believes they stopped. Decide it: `if (!effectiveState.isPresent('<module>')) return;`\n" +
        '— first, and outside any `try`. `backend/src/modules/ksef/plugin.ts` (timer) and\n' +
        '`packages/modules/product_feeds/src/backend/index.ts` (boot hook) are the worked\n' +
        'examples.\n',
    );
    for (const entry of plain) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler}: ${remedyFor(entry)}`,
      );
    }
  }

  if (mixed.length > 0) {
    console.error(
      '\nA boot hook below does work **and** contributes to another module in one body.\n' +
        'Adding a presence check at the top of it is the WRONG repair: it would stop the\n' +
        'contribution as well, and a contribution the host filters by contributor is meant to\n' +
        'stay registered while its owner is off. `blog` and `cms` each registered an\n' +
        'asset-reference scanner beside their own work — probing those hooks would let an\n' +
        'operator delete an asset a switched-off module still references, which surfaces as\n' +
        'data loss at reactivation.\n\n' +
        'SPLIT IT FIRST: two `ctx.onBoot` calls — the contribution one unprobed, the work one\n' +
        'probed — then this check judges the work half on its own. Both worked examples are\n' +
        'module packages now, so the file to read is each one\'s `./backend` entry point:\n' +
        '`packages/modules/blog/src/backend/index.ts` and\n' +
        '`packages/modules/cms/src/backend/index.ts`.\n',
    );
    for (const entry of mixed) {
      console.error(
        `  - ${entry.file}:${entry.line}  [${entry.moduleId}] ${entry.construct} in ` +
          `${entry.scheduler}: ${remedyFor(entry)}`,
      );
    }
  }

  if (result.stale.length > 0) {
    console.error(
      '\nStale ledger entries (no longer describe an ungated entry point — delete them):',
    );
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
