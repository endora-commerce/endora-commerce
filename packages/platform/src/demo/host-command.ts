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

/** `--help`, answered from the declaration alone — before anything is composed. */
export function demoHelpFor(verb: DemoMode): string {
  const seeding = verb === 'seed';
  return (
    `endora ${DEMO_HOST_COMMAND} ${verb}\n\n` +
    (seeding
      ? 'Creates the demo data of every module that is installed here and switched on,\n' +
        "in the order the manifest dependency graph gives, then applies this instance's\n" +
        'own composition — the wiring that spans modules. A module that is not present\n' +
        'contributes nothing and is reported as a skip, never as an error.\n'
      : "Withdraws this instance's composition and then every present module's demo\n" +
        'rows, in the reverse of the order they were created in. Rows you created\n' +
        'yourself are left alone.\n') +
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
 * The one sentence §5.6 asks for. It says what is absent and what that means,
 * and enumerates nothing.
 *
 * It is the platform's rather than any one tree's because the **dispatcher**
 * prints it: an instance that supplies no composition loader at all is the
 * ordinary case (D-216 — a client scaffolding an instance for their own trading
 * receives no demo artefact unless they ask), and the default has to say so
 * without the instance holding a copy of the sentence.
 */
export const NO_DEMO_COMPOSITION_NOTICE =
  'No demo composition was found in this instance, so only the modules above ran. ' +
  'A composition is the wiring that spans modules — which categories a menu mirrors, ' +
  'which channel sells which products — and it belongs to whoever owns the instance, ' +
  'not to the platform. An instance without one is an ordinary instance.';

/** What a composition loader is given. */
export interface DemoCompositionInput {
  readonly em: EntityManager;
  readonly isPresent: (moduleId: string) => boolean;
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
 * (`operator-half.md` §1.1). This repository's is
 * `backend/src/demo/composition-loader.ts`; a scaffolded instance supplies none
 * and gets {@link NO_DEMO_COMPOSITION_NOTICE}.
 */
export type DemoCompositionLoader = (
  input: DemoCompositionInput,
) => Promise<DemoCompositionLookup>;
