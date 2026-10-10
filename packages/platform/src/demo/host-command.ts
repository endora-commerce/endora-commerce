/**
 * The host's side of `endora demo seed` and `endora demo reset` (feature 113
 * Phase 0, `contracts/module-demo-data-layer.md` §3.1–§3.2), and the shape the
 * dispatcher takes an instance's own composition in.
 *
 * ## Why it is a *host* command and not a module's
 *
 * §3.2: both commands live on the CLI that **composes the platform** and must
 * not live on `@endora-commerce/cli`. The scaffolder opens no database, resolves
 * no container and builds no `ModuleContext`; acquiring those would make it the
 * platform. And the demo run is not any one module's command — it fans out over
 * every module that declares demo data — so it cannot be a `cliCommands` entry
 * either, which is addressed as `<module id> <command>` and runs exactly one.
 *
 * ## Why it is in the package now, and it was the last thing keeping a
 * scaffolded instance from running any command at all
 *
 * It was `backend/src/cli/demo-command.ts`, and
 * `test/unit/kernel/host-residue-partition.test.ts` had it ledgered as
 * *"platform-shaped — the move"*: it names no path in the tree that installs the
 * platform, so `operator-half.md` §1.1 puts it here. The ledger's `retiredBy`
 * named the shape this took — *"the logic in the package, a ~20-line entry point
 * in the application"*.
 *
 * The cost of leaving it was measured rather than aesthetic. `endora new
 * instance` reported `backend/src/cli.ts` as an **omission**, whose written
 * reason was *"the demo layer around it is exported under no subpath"* — and a
 * scaffolded instance therefore had no `admin_users create`, so nobody could log
 * in to the admin bundle A5 and A13 prove is built and styled
 * (`specs/123-oss-install-experience/` G2).
 *
 * ## What is here and what the dispatcher's
 *
 * The same split `module-commands.ts` makes: everything decidable with no
 * process and no database is here, so it can be driven from a test. The three
 * things that are **not** are the ones §3.3 orders relative to each other — the
 * production guard first, then the composition, then one system scope — and
 * their order is `../cli/dispatch.ts`' property rather than a value this file
 * could return.
 */
import type { ModuleManifest } from '@endora-commerce/contracts';
import { DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG } from './refusal.js';
import type { EntityManager } from '@mikro-orm/postgresql';

import { UnknownCommandError } from '../cli/module-commands.js';

import type { DemoManifestEntry, DemoMode } from './plan.js';
import type { DemoComposition } from './runner.js';

/** The one host verb this feature adds. */
export const DEMO_HOST_COMMAND = 'demo';

/** One command the **host** offers, in the address an operator types. */
export interface HostCommandDescriptor {
  readonly address: string;
  readonly summary: string;
}

export const DEMO_HOST_COMMANDS: readonly HostCommandDescriptor[] = [
  {
    address: `${DEMO_HOST_COMMAND} seed`,
    summary: "Create every present module's demo data, plus the instance composition.",
  },
  {
    address: `${DEMO_HOST_COMMAND} reset`,
    summary: 'Withdraw the demo data this instance seeded, leaving your own rows alone.',
  },
];

const DEMO_VERBS: readonly DemoMode[] = ['seed', 'reset'];

/** Is this argv the host's demo command rather than a module id? */
export function isDemoInvocation(first: string | undefined): boolean {
  return first === DEMO_HOST_COMMAND;
}

/**
 * `seed` or `reset`, or a refusal naming what the command does offer.
 *
 * Refuses rather than defaulting: the two directions are destructive in
 * opposite ways, and a missing verb that chose one would be the worst possible
 * guess.
 */
export function parseDemoVerb(name: string | undefined): DemoMode {
  const found = DEMO_VERBS.find((verb) => verb === name);
  if (found) return found;
  const typed = name === undefined ? DEMO_HOST_COMMAND : `${DEMO_HOST_COMMAND} ${name}`;
  throw new UnknownCommandError(
    `[cli] '${typed}' is not a demo command. It offers: ${DEMO_VERBS.join(', ')}.`,
  );
}

/**
 * `--help`, answered from the declaration alone — before anything is composed.
 *
 * `program` is how the operator reached the dispatcher, and it is a parameter
 * for defect F-1's reason: this line used to open `endora demo seed`, and in a
 * scaffolded instance `endora` is the scaffolder, which has no demo verb
 * (`specs/125-first-mile-install/spec.md` §2.5). The dispatcher is told; this
 * function is told by the dispatcher.
 */
export function demoHelpFor(verb: DemoMode, program = 'pnpm run cli'): string {
  const seeding = verb === 'seed';
  return (
    `${program} ${DEMO_HOST_COMMAND} ${verb}\n\n` +
    (seeding
      ? 'Creates the demo data of every module that is installed here and switched on,\n' +
        "in the order the manifest dependency graph gives, then applies this instance's\n" +
        'own composition — the wiring that spans modules. A module that is not present\n' +
        'contributes nothing and is reported as a skip, never as an error.\n'
      : "Withdraws this instance's composition and then every present module's demo\n" +
        'rows, in the reverse of the order they were created in — together with what\n' +
        'using the demo created under the demo organisation. Rows that belong to\n' +
        'anybody else are left alone. It runs in one transaction: a reset that is\n' +
        'refused has changed nothing.\n\n' +
        'It refuses when the demo organisation holds financial records, and names what\n' +
        'it found: a payment that was paid or refunded; an invoice or a correction, or\n' +
        'an invoice of any kind with a KSeF or external reference; an accounting-system\n' +
        'record; a refund. Orders placed and never paid — an awaiting or deferred\n' +
        'payment, a pro-forma invoice — do not count and are withdrawn as they are.\n' +
        `${DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG} deletes the financial records with the rest;\n` +
        'it is read from this command line only and skips no other guard.\n') +
    '\nIt refuses to run against a production database — both NODE_ENV and the\n' +
    'DATABASE_URL are checked, each with its own explicit override — and writes\n' +
    'nothing when it refuses.\n'
  );
}

/** `--list` output for the host's own commands, in `formatCommandList`'s shape. */
export function formatHostCommandList(commands: readonly HostCommandDescriptor[]): string {
  const width = Math.max(...commands.map((command) => command.address.length));
  return `${commands
    .map((command) => `  ${command.address.padEnd(width)}  ${command.summary}`)
    .join('\n')}\n`;
}

/** A module id that would be unreachable because the host reads it as a verb. */
export class ShadowedHostCommandError extends Error {
  constructor(readonly moduleId: string) {
    super(
      `[cli] a module is installed with the id '${moduleId}', which is the host's own ` +
        `command. The host reads the first argument as its own verb before it dispatches ` +
        `to a module, so that module's commands would be unreachable. Rename the module.`,
    );
    this.name = 'ShadowedHostCommandError';
  }
}

/** The minimum of a resolved manifest entry this file reads. */
interface ManifestCarrier {
  readonly manifest: Pick<ModuleManifest, 'id' | 'dependencies' | 'demo'>;
}

/**
 * The runner's input, from the set the composition was actually built from.
 *
 * It carries the declaration and not the presence answer: §3.5 puts that
 * decision in `planDemoRun`, before a context is built and outside every `try`.
 *
 * The refusal is here because this is the one place that sees every resolved id
 * next to the host's own verb. `moduleIdRe` admits `demo`, and the verb is read
 * first, so such a module would have commands nothing could address — the
 * *"command silently not found"* failure D-157.8 rejected path-convention
 * dispatch for.
 */
export function demoEntriesFrom(entries: readonly ManifestCarrier[]): DemoManifestEntry[] {
  return entries.map((entry) => {
    if (entry.manifest.id === DEMO_HOST_COMMAND) {
      throw new ShadowedHostCommandError(entry.manifest.id);
    }
    return {
      id: entry.manifest.id,
      dependencies: entry.manifest.dependencies,
      ...(entry.manifest.demo === undefined ? {} : { demo: entry.manifest.demo }),
    };
  });
}

/**
 * The one sentence §5.6 asks for. It says what is absent, what that means and
 * how an instance asks for one, and enumerates no step.
 *
 * It is the platform's rather than any one tree's because the **dispatcher**
 * prints it: an instance that supplies no composition loader and installs no
 * composition package is the ordinary case (D-216 — a client scaffolding an
 * instance for their own trading receives no demo artefact unless they ask),
 * and the default has to say so without the instance holding a copy of the
 * sentence.
 *
 * **It says how to ask, and that was the defect.** Until 2026-10-01 it said
 * only that an instance without a composition is ordinary — true, and the whole
 * of what an operator who had just seeded 203 products no channel sold was
 * told. It names Endora's own composition package so the operator can install
 * it; naming a package in a sentence is not depending on it, and nothing here
 * imports it — the dispatcher finds whichever package declares the type
 * (`installed-composition.ts`), Endora's or the instance owner's own.
 */
export const NO_DEMO_COMPOSITION_NOTICE =
  'No demo composition was found in this instance, so only the modules above ran: their ' +
  'rows exist, but nothing wires them together — no channel sells the demo products and ' +
  'no demo administrator holds a role. A composition is that wiring, and it belongs to ' +
  'whoever owns the instance, not to the platform. The demo shop\'s own is a package: ' +
  '`pnpm add -w @endora-commerce/demo-composition` at the instance root, then run this ' +
  'command again. An instance ' +
  'without one is an ordinary instance.';

/** What a composition loader is given. */
export interface DemoCompositionInput {
  readonly em: EntityManager;
  readonly isPresent: (moduleId: string) => boolean;
  /**
   * The operator passed `--force-delete-financial-records` to this `demo
   * reset` (issue #143 — `refusal.ts`). Absent or `false`, a composition that
   * finds financial records among what it would delete refuses the reset.
   *
   * The dispatcher sets it from the command line of the invocation and from
   * nothing else — never from the environment, never from a setting.
   */
  readonly deleteFinancialRecords?: boolean;
}

/** Present and loaded, or absent with the sentence to print. Never both. */
export type DemoCompositionLookup =
  | { readonly found: true; readonly composition: DemoComposition }
  | { readonly found: false; readonly notice: string };

/**
 * Finding a tree's demo composition — the parameter, not an implementation.
 *
 * **Locating one is the application's**, and that is the whole of why this is a
 * function type rather than a function: the file lives at a path relative to the
 * *caller's* own source, which is a path in a tree the platform cannot name
 * (`operator-half.md` §1.1). This repository's names
 * `@endora-commerce/demo-composition` in `backend/src/cli.ts`; a scaffolded
 * instance supplies none
 * and the dispatcher looks for an installed demo-composition package instead
 * (`installed-composition.ts`), printing {@link NO_DEMO_COMPOSITION_NOTICE} when
 * there is none.
 */
export type DemoCompositionLoader = (
  input: DemoCompositionInput,
) => Promise<DemoCompositionLookup>;
