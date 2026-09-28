#!/usr/bin/env node
/**
 * `endora` — the argv layer, and nothing else.
 *
 * Three properties are contract (`contracts/cli-surface.md` §1–§2):
 *
 *   * **`node:util`'s `parseArgs`**, so the program takes no dependency to read
 *     its own arguments, and an unrecognised flag is a refusal rather than a
 *     silent ignore.
 *   * **non-interactive by default, and guaranteed** (`cli-product.md` R2.5c,
 *     amending R2.5). A value the tool invented is still a value nobody
 *     reviewed, and nothing here invents one: a command that resolves inputs
 *     prints a provenance line whose `defaulted=` is `0`. What the amendment
 *     added is a *fallback* — on a terminal, a missing **required** input is
 *     asked for rather than refused. A prompt is issued only when stdin and
 *     stdout are both TTYs, `--non-interactive` and `--dry-run` are absent and
 *     no CI marker is set; failing any of those, a missing required input is
 *     exit `1` naming every one of them and the flag that supplies each, in one
 *     refusal. No command may block on a question nobody can answer.
 *   * **one meaning per exit code.** `0` did what it was asked and found nothing
 *     to report; `1` a finding or a refusal the author can act on; `2` an input
 *     it could not read. `2` is never reported as clean and never merged into
 *     `1`: a run that could not read its input has said nothing about the tree.
 *
 * It reads no configuration file. There is no `.endorarc` and no environment
 * variable that changes a verdict.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { estateIds, runCheck } from '../check/index.js';
import { NotAModulePackageError } from '../check/layout.js';
import { runNewModule } from '../new-module/index.js';
import { ScaffoldHostError, ScaffoldInputError } from '../new-module/spec.js';
import { DeclarationLoadError } from '../inputs/declaration.js';
import { inputForFlag } from '../inputs/resolve.js';
import {
  MissingInputsError,
  runNewStorefront,
  storefrontInputFlags,
} from '../new-storefront/index.js';
import { StorefrontHostError, StorefrontInputError } from '../new-storefront/reference.js';
import {
  InstanceHostError,
  InstanceInputError,
  runNewInstance,
} from '../new-instance/index.js';
import { InstallHostError, InstallInputError, runInstall } from '../install/index.js';
import { DevHostError, DevInputError, runDev } from '../dev/index.js';
import {
  generateReport,
  GenerateHostError,
  GenerateInputError,
  runGenerate,
} from '../generate/index.js';

const USAGE = `endora — scaffolding and conformance tooling for Endora Commerce modules.

Usage:
  endora new module <id> --name <text> --description <text> [options]
  endora new instance <dir> [--module <id>...] [--deployment <name>] [--registry <url>]
                            [--topology single-host|three-host] [--dry-run]
  endora new storefront <dir> [--registry <url>] [--<input> <value>...] [--dry-run]
  endora install <dir> --admin-email <e> --admin-password <p> --admin-first-name <f>
                       --admin-last-name <l> (--demo | --no-demo)
                       [--no-services] [--no-storefront] [--storefront-dir <path>]
                       [--module <id>...] [--deployment <name>] [--registry <url>]
                       [--topology single-host|three-host] [--dry-run]
  endora generate [--dry-run]
  endora dev [--storefront-dir <path>] [--no-storefront]
  endora --help

\`endora new module\` writes a module package that is composed by the platform,
gated by the operator, discoverable in the command palette and correct on its
first commit. It does not author the package's package.json: that file is
rendered by the platform's own manifest generator, so the two cannot disagree.

Options for \`new module\`:
  --name <text>                 the module's human-readable name (required)
  --description <text>          one sentence; seeds the package description (required)
  --dir <path>                  where to write (default: the workspace's module tree)
  --scope <@scope/>             the npm scope; must be the workspace's own
  --depends <id>[,<id>...]      manifest dependencies (repeatable)
  --permission <code>=<label>   a permission code and its operator-facing label (repeatable)
  --action <id>=<route>         a command-palette action and the admin route it opens (repeatable)
  --icon <KnownIconName>        the icon for the emitted actions (default: Boxes)
  --admin <navSection>          emit the ./admin layer: a gated screen and the sidebar entry
                                that opens it, in the named section (main, sales, catalog,
                                inventory, pricing, customers, channels, content, messaging,
                                newsletter, analyticsAds, system). Needs a --permission
  --entities                    own a table: an entity, a migration and the ./migrations subpath
  --tenant-scope <scope>        org-scoped | customer-scoped | global (default: org-scoped)
  --ports                       publish a type-only ./ports subpath other modules resolve
  --worker                      register a queue consumer through the module seam
  --subscriber                  register an event subscription through the module seam
  --activation-setting <code>   the Setting holding the operator's on/off choice
                                (default: <id>.enabled)
  --non-deactivatable <reason>  declare that the platform cannot run without this module
  --dry-run                     report what would be written; write nothing

\`endora new instance\` writes the repository that composes this platform for one
deployment: one workspace, one module list, and a copy of nothing. It is not a
fork of the platform and holds no file of it — the platform, the admin shell and
every module arrive as dependencies, so a fix in any of them reaches you through
\`pnpm update\` with no file in your tree edited.

Options for \`new instance\`:
  <dir>                         where to write. Required; it must be empty, or
                                hold nothing but a \`.env\` you placed there. Its
                                basename becomes the workspace name
  --module <id>[,<id>...]       a module to install (repeatable). The set is
                                closed over the manifests' own dependencies.
                                Given none, it writes the smallest set that
                                composes — the modules the platform cannot run
                                without, closed the same way
  --deployment <name>           the directory under \`apps/\` holding your overlay
                                modules and your divergence declaration, and the
                                value of \`DEPLOYMENT\` (default: the workspace name)
  --registry <url>              the endpoint the instance installs
                                \`@endora-commerce/*\` from. It writes an \`.npmrc\`
                                naming that endpoint, with the token as an
                                environment reference and never as a value
  --topology <name>             which machine layout the EXAMPLE deployment files
                                in \`deploy/\` describe: \`single-host\` (default) puts
                                every layer on one machine, \`three-host\` writes one
                                compose example and one \`.env.example\` per machine
                                for a backend, a storefront and an admin that scale
                                apart. It selects; it records nothing — no file in
                                the tree carries the value and nothing reads it back
  --dry-run                     report every file it would write, the resolved
                                module set with its closure, and every omission;
                                write nothing

\`endora install\` is the one command: it writes the instance (and, from inside a
checkout of this repository, the storefront beside it), starts the development
services, installs, generates, builds, migrates, installs every module and creates
the administrator — the sequence \`endora new instance\` prints and nothing else. It
composes the two \`new\` commands and reimplements neither, it never prompts, and
every step is echoed before it runs so an operator can reproduce any one of them by
hand. A failing step exits with that step's own code and prints what is left.

Options for \`install\`:
  <dir>                         where the instance goes. Required; it must be empty,
                                or hold nothing but a \`.env\` you placed there
  --admin-email <address>       the administrator you sign in as. All four are
  --admin-password <secret>     required: nothing else creates an account, and the
  --admin-first-name <text>     password is never generated — it is the one value
  --admin-last-name <text>      you have to remember
  --demo | --no-demo            whether to seed every installed module's example
                                data. Required, and deliberately with no default:
                                an instance you will sell from wants none of it and
                                one you are evaluating wants it before the first
                                screen. Seeding runs last and a failure in it does
                                not fail the install
  --no-services                 do not start PostgreSQL, Redis, Meilisearch and the
                                mail catcher, and do not write their addresses into
                                the instance's \`.env\`. Use it when you run those
                                services yourself
  --no-storefront               write the instance alone. The storefront is copied
                                out of a checkout of this repository, so a run from
                                anywhere else needs this flag
  --storefront-dir <path>       where the storefront goes (default: \`<dir>-storefront\`,
                                a SIBLING — inside the instance it would be swept into
                                that workspace and become a member of it)
  --module, --deployment, --registry, --topology
                                passed through to \`new instance\` unread
  --dry-run                     report every file and every step; write nothing,
                                start nothing and run nothing

\`endora dev\` is what an instance's \`pnpm run dev:all\` runs: the API (\`pnpm run
start\`), the admin preview (\`pnpm run preview:admin\`) and, when there is one, the
storefront beside the instance (its \`pnpm run dev\`), in one terminal with each
line prefixed by its layer. Ctrl-C stops all of them; any one ending stops the
rest and names which. It changes no layer's own build or start command — each is
still deployed on its own. Run it from the instance's root.

Options for \`dev\`:
  --storefront-dir <path>       where the storefront is (default: \`<dir>-storefront\`
                                beside the instance, when it exists)
  --no-storefront               start the API and the admin preview only

\`endora generate\` renders the two files an instance's admin project is built
from and commits neither: the contribution registry of the module packages this
instance installed, and the stylesheet enumeration that makes their utility
classes survive Tailwind's scan. Both are facts about the install rather than
about the tree, so they are regenerated after every \`pnpm install\` and are
git-ignored. Run it anywhere inside the instance; it finds the workspace root
upwards. It reports every package the discovery excluded, because a linked
package is invisible to this instance's runtime discovery too.

\`endora new storefront\` copies the reference storefront out of this repository
into a directory you then own outright, and rewrites every declaration in it that
names something above the storefront's own directory: each \`workspace:\` range
into published semver, each configuration file the storefront extends into a
vendored standalone copy, and each glob naming the workspace's package tree into
the place a standalone application finds those packages. It keeps no channel back
to what it wrote — a scaffold that did would be a kit wearing a different name
(D-195). An outward declaration it cannot make standalone is a refusal, never a
file copied out unchanged.

Options for \`new storefront\`:
  <dir>                         where to write. Required; it must be empty, or
                                hold nothing but a \`.env\` you placed there
  --<input> <value>             a value for one of the inputs the reference
                                storefront declares, named after the variable in
                                lower case with underscores as dashes —
                                \`--next-public-api-base-url https://api.example.com\`.
                                Inputs resolve in one fixed order: this flag,
                                then a \`.env\` already in the target directory,
                                then a prompt if you are on a terminal, then a
                                refusal naming every one that is still missing.
                                Run with \`--dry-run\` to see the list first
  --non-interactive             refuse rather than ask, even on a terminal
  --registry <url>              the endpoint the scaffold installs \`@endora-commerce/*\`
                                from. It writes an \`.npmrc\` naming that endpoint for the
                                scopes the storefront declares, with the token as
                                \`\${ENDORA_NPM_TOKEN}\` — an environment reference pnpm
                                expands at install time, so the file holds no secret and
                                is committable. Omitted, it writes no \`.npmrc\` at all,
                                which is what a consumer of the public registry holds
  --dry-run                     report the copy, every rewrite and every omission;
                                write nothing

\`endora check\` evaluates the platform's whole static-check estate against one
module package. Every rule in that estate gets exactly one verdict on every run —
it ran (clean, or with findings), it is \`not-applicable\` because the package
declares no subject for it or because its subject is the platform repository, it
is \`unreadable\` because an input the author can supply is absent, or it is
\`pending\` because this build has no package-scope host for it yet. A rule that
is neither run nor explained is the silent skip the whole design refuses, which
is why the incompleteness is **printed** rather than waived: while any rule is
\`pending\` the run exits 2 and names the phase that lands it.

Options for \`check\`:
  [path]                        the module package to check (default: the working
                                directory, or the nearest ancestor declaring
                                \`endora: { "type": "module", "id": … }\`)
  --rule <id>                   evaluate only this rule (repeatable). It can only
                                remove; there is no flag that adds a rule, changes
                                a verdict or relaxes a refusal
  --as-platform                 read every acknowledged finding as a finding. The
                                package's own ledger answers the author's question
                                (is my module in the state I decided it should be
                                in?) and never the platform's (does this module
                                satisfy the rules we admit modules on?)
  --list-rules                  print the estate and each rule's classification

Exit codes: 0 the estate was completely evaluated and found nothing; 1 it was
completely evaluated and there are findings; 2 the picture is incomplete — some
rule could not be read, or has no host in this build. \`findings=<n>\` is on the
arithmetic line whatever the code is.
`;

interface Parsed {
  readonly values: Record<string, string | boolean | string[] | undefined>;
  readonly positionals: readonly string[];
}

/**
 * `strict: true` stays, and the option table grows instead.
 *
 * `endora new storefront` accepts one flag per input the reference storefront
 * **declares** (feature 117, FR-010), and those names are the storefront's
 * rather than this program's. Parsing that subcommand leniently was the obvious
 * alternative and is the wrong one: it would turn a typo'd
 * `--next-public-api-base-ur` from a loud refusal into a silently unset required
 * input, which is the class of failure this whole feature exists to remove. So
 * the names are resolved from the declaration first and handed in here.
 */
function parse(argv: readonly string[], declaredInputFlags: readonly string[] = []): Parsed {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      ...Object.fromEntries(
        declaredInputFlags.map((flag) => [flag, { type: 'string' as const }]),
      ),
      help: { type: 'boolean', short: 'h' },
      rule: { type: 'string', multiple: true },
      'as-platform': { type: 'boolean' },
      'list-rules': { type: 'boolean' },
      name: { type: 'string' },
      description: { type: 'string' },
      dir: { type: 'string' },
      scope: { type: 'string' },
      depends: { type: 'string', multiple: true },
      permission: { type: 'string', multiple: true },
      action: { type: 'string', multiple: true },
      icon: { type: 'string' },
      admin: { type: 'string' },
      entities: { type: 'boolean' },
      ports: { type: 'boolean' },
      worker: { type: 'boolean' },
      subscriber: { type: 'boolean' },
      'tenant-scope': { type: 'string' },
      'activation-setting': { type: 'string' },
      'non-deactivatable': { type: 'string' },
      module: { type: 'string', multiple: true },
      deployment: { type: 'string' },
      registry: { type: 'string' },
      topology: { type: 'string' },
      'non-interactive': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      // `endora install` (feature 125). `--no-*` is a flag of its own rather
      // than a negation `parseArgs` understands: the library has no negation,
      // and a default that is `true` needs a name to be turned off by.
      'no-services': { type: 'boolean' },
      'no-storefront': { type: 'boolean' },
      'storefront-dir': { type: 'string' },
      'admin-email': { type: 'string' },
      'admin-password': { type: 'string' },
      'admin-first-name': { type: 'string' },
      'admin-last-name': { type: 'string' },
      'revalidate-secret': { type: 'string' },
      demo: { type: 'boolean' },
      'no-demo': { type: 'boolean' },
    },
  });
  return { values, positionals };
}

function asString(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asList(value: string | boolean | string[] | undefined): readonly string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => entry.split(','));
  return typeof value === 'string' ? value.split(',') : [];
}

function asFlag(value: string | boolean | string[] | undefined): boolean {
  return value === true;
}

/**
 * `endora check` — the argv half.
 *
 * It resolves nothing and decides nothing: the package comes off the working
 * directory (or one positional), the verdicts come from the estate, and the exit
 * code is `runCheck`'s. A flag that could change a verdict is the configuration
 * this program does not have.
 */
function runCheckCommand(parsed: Parsed, positionals: readonly string[], cwd: string): number {
  if (asFlag(parsed.values['list-rules'])) {
    for (const id of estateIds()) process.stdout.write(`${id}\n`);
    return 0;
  }
  if (positionals.length > 1) {
    process.stderr.write(
      `endora: \`check\` takes one package path; got ${positionals.length} ` +
        `(${positionals.join(', ')}).\n`,
    );
    return 1;
  }

  const rules = asList(parsed.values['rule']);
  const known = new Set(estateIds());
  const unknown = rules.filter((rule) => !known.has(rule));
  if (unknown.length > 0) {
    process.stderr.write(
      `endora: \`--rule\` names ${unknown.join(', ')}, which the estate does not hold. ` +
        `Run \`endora check --list-rules\` for the ids.\n`,
    );
    return 1;
  }

  try {
    const run = runCheck({
      cwd: positionals[0] === undefined ? cwd : resolve(cwd, positionals[0]),
      rules,
      asPlatform: asFlag(parsed.values['as-platform']),
    });
    for (const line of run.lines) process.stdout.write(`${line}\n`);
    return run.report.exitCode;
  } catch (error: unknown) {
    if (error instanceof NotAModulePackageError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    // Anything else is an input this run could not read, and a run that could
    // not read its input has said nothing about the tree.
    process.stderr.write(
      `endora: check could not read its input: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
}


/**
 * `endora new storefront` — the argv half.
 *
 * It decides nothing. The target comes off one positional, the population and
 * every rewrite come from the reference storefront in this checkout, and the
 * exit code is the refusal's class: an author-fixable refusal is 1, a checkout
 * this command cannot read a reference storefront out of is 2.
 */
async function runNewStorefrontCommand(
  parsed: Parsed,
  rest: readonly string[],
  cwd: string,
  declaredInputFlags: readonly string[],
): Promise<number> {
  if (rest.length > 1) {
    process.stderr.write(
      `endora: \`new storefront\` takes one directory; got ${String(rest.length)} ` +
        `(${rest.join(', ')}).\n`,
    );
    return 1;
  }
  // The inputs, keyed by **variable name**: the flag is derived from the name
  // (`inputForFlag`), so a storefront declaring a variable this build has never
  // heard of is supplied by its own flag with nothing here to update.
  const inputs: Record<string, string> = {};
  for (const flag of declaredInputFlags) {
    const value = asString(parsed.values[flag]);
    if (value !== undefined) inputs[inputForFlag(flag)] = value;
  }

  try {
    const result = await runNewStorefront({
      ...(rest[0] === undefined ? {} : { dir: rest[0] }),
      ...(asString(parsed.values['registry']) === undefined
        ? {}
        : { registry: asString(parsed.values['registry'])! }),
      dryRun: asFlag(parsed.values['dry-run']),
      nonInteractive: asFlag(parsed.values['non-interactive']),
      inputs,
      cwd,
    });
    const { plan } = result;
    process.stdout.write(
      `endora new storefront ${result.targetDir}${result.dryRun ? ' — dry run, nothing written' : ''}\n`,
    );
    process.stdout.write(
      `  ${result.dryRun ? 'would write' : 'wrote'} ${String(plan.files.length)} files, from ` +
        `${result.reference.dir}\n`,
    );
    for (const range of plan.ranges) {
      process.stdout.write(
        `  ${range.field}.${range.name}: ${range.from} -> ${range.to}\n`,
      );
    }
    for (const rewrite of plan.rewrites) {
      process.stdout.write(`  ${rewrite.file}: ${rewrite.specifier} -> ${rewrite.to}\n`);
    }
    for (const file of plan.files) {
      if (file.source === null && file.path !== 'package.json') {
        process.stdout.write(`  ${file.path} — ${file.note ?? ''}\n`);
      }
    }
    for (const omission of plan.omitted) {
      process.stdout.write(`  omitted ${omission.path} — ${omission.reason}\n`);
    }
    // R2.1 — one provenance line per run, accounting for every input, with a
    // `defaulted=` count that is contract-bound to `0`. It is printed on every
    // run including a dry one, because the claim it makes is about the run.
    process.stdout.write(`\n${result.provenance}\n`);
    for (const name of result.wouldPrompt) {
      process.stdout.write(`  would ask for ${name}\n`);
    }
    for (const name of result.wouldGenerate) {
      process.stdout.write(`  would generate ${name}\n`);
    }
    for (const name of result.unset) {
      process.stdout.write(`  left unset ${name} — optional\n`);
    }
    process.stdout.write(`\nNext steps:\n`);
    result.nextSteps.forEach((step, index) => {
      process.stdout.write(`  ${String(index + 1)}. ${step}\n`);
    });
    return 0;
  } catch (error: unknown) {
    // A missing required input is a ninth refusal class and it is exit `1`
    // (R7.2): the operator has something to supply, and the message names every
    // one at once rather than the first.
    if (error instanceof MissingInputsError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    if (error instanceof StorefrontInputError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    // A declaration this run could not read is a derivation failure, not an
    // operator input: R7.1 — asking a human to type a value the tool failed to
    // *read* is how a wrong value enters wearing the operator's authority.
    if (error instanceof DeclarationLoadError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    if (error instanceof StorefrontHostError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/**
 * `endora new instance` — the argv half.
 *
 * It decides nothing. The target comes off one positional, the module set and
 * every range come from the packages the command resolved, and the exit code is
 * the refusal's class: an operator-fixable refusal is 1, an input the run could
 * not read is 2 (`instance-tree.md` §4).
 */
/**
 * `endora generate` — the artefacts an instance is built from and commits none
 * of (`contracts/instance-tree.md` §2.6): its admin project's two, and its
 * documentation site's navigation, module map and per-module reference pages.
 *
 * It takes no positional: the instance is the workspace above the working
 * directory, so `pnpm -C admin run generate` and a client standing in the root
 * both answer the same. A positional would be a second way to name a tree the
 * run is already standing in.
 */
async function runGenerateCommand(
  parsed: Parsed,
  rest: readonly string[],
  cwd: string,
): Promise<number> {
  if (rest.length > 0) {
    process.stderr.write(
      `endora: \`generate\` takes no argument; got ${rest.join(', ')}. It renders the ` +
        `artefacts of the instance whose workspace root is above the current directory.\n`,
    );
    return 1;
  }
  try {
    const result = await runGenerate({ cwd, dryRun: asFlag(parsed.values['dry-run']) });
    process.stdout.write(
      `endora generate ${result.root}${result.dryRun ? ' — dry run, nothing written' : ''}\n`,
    );
    for (const line of generateReport(result)) process.stdout.write(`  ${line}\n`);
    process.stdout.write(
      `  ${String(result.modules)} installed module package(s) in the population\n`,
    );
    return 0;
  } catch (error: unknown) {
    if (error instanceof GenerateInputError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    if (error instanceof GenerateHostError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

async function runNewInstanceCommand(
  parsed: Parsed,
  rest: readonly string[],
  cwd: string,
): Promise<number> {
  if (rest.length > 1) {
    process.stderr.write(
      `endora: \`new instance\` takes one directory; got ${String(rest.length)} ` +
        `(${rest.join(', ')}).\n`,
    );
    return 1;
  }
  try {
    const result = await runNewInstance({
      ...(rest[0] === undefined ? {} : { dir: rest[0] }),
      modules: asList(parsed.values['module']),
      ...(asString(parsed.values['deployment']) === undefined
        ? {}
        : { deployment: asString(parsed.values['deployment'])! }),
      ...(asString(parsed.values['registry']) === undefined
        ? {}
        : { registry: asString(parsed.values['registry'])! }),
      ...(asString(parsed.values['topology']) === undefined
        ? {}
        : { topology: asString(parsed.values['topology'])! }),
      dryRun: asFlag(parsed.values['dry-run']),
      cwd,
    });
    const { plan, modules } = result;
    process.stdout.write(
      `endora new instance ${result.targetDir}` +
        `${result.dryRun ? ' — dry run, nothing written' : ''}\n`,
    );
    process.stdout.write(
      `  ${result.dryRun ? 'would write' : 'wrote'} ${String(plan.files.length)} files ` +
        `across ${plan.members.join(', ')}\n`,
    );
    for (const file of plan.files) {
      process.stdout.write(`  ${result.dryRun ? 'would write' : 'wrote'} ${file.path} — ${file.kind}\n`);
    }
    // §3 — the set, its closure and where the default came from, because a
    // module list nobody can see the derivation of is a list.
    process.stdout.write(
      `\n[modules] ${String(modules.ids.length)} in the set` +
        `${modules.defaulted ? ' (no --module given: the modules the platform cannot run without)' : ''}` +
        `: ${modules.ids.join(', ')}\n`,
    );
    if (modules.closure.length > 0) {
      process.stdout.write(`  added by closure: ${modules.closure.join(', ')}\n`);
    }
    if (plan.registry !== null) {
      process.stdout.write(`  installs from ${plan.registry}\n`);
    }
    for (const omission of plan.omitted) {
      process.stdout.write(`  omitted ${omission.path} — ${omission.reason}\n`);
    }
    process.stdout.write(`  wiring: ${String(result.wiringLines)} lines\n`);
    process.stdout.write(`\n${result.provenance}\n`);
    process.stdout.write(`\nNext steps:\n`);
    result.nextSteps.forEach((step, index) => {
      process.stdout.write(`  ${String(index + 1)}. ${step}\n`);
    });
    return 0;
  } catch (error: unknown) {
    if (error instanceof InstanceInputError) {
      process.stderr.write(`endora: [${error.refusal}] ${error.message}\n`);
      return 1;
    }
    if (error instanceof InstanceHostError) {
      process.stderr.write(`endora: [${error.refusal}] ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/**
 * `endora install` — the argv half (feature 125, FR-140…FR-161).
 *
 * It decides nothing of its own. Every value is a flag, the two trees are
 * written by the two `new` commands, and the exit code is either the refusal's
 * class — 1 for an operator-fixable refusal, 2 for an input it could not read —
 * or, when the pipeline ran and a step failed, **that step's own code** (FR-156).
 */
async function runInstallCommand(
  parsed: Parsed,
  rest: readonly string[],
  cwd: string,
): Promise<number> {
  if (rest.length > 1) {
    process.stderr.write(
      `endora: \`install\` takes one directory; got ${String(rest.length)} ` +
        `(${rest.join(', ')}).\n`,
    );
    return 1;
  }
  // `--demo` and `--no-demo` are two flags and one answer, so a run that gives
  // both is a run whose author believes two different things. Refused rather
  // than resolved by precedence: a precedence rule here would silently discard
  // half of what they typed.
  if (asFlag(parsed.values['demo']) && asFlag(parsed.values['no-demo'])) {
    process.stderr.write(
      'endora: `--demo` and `--no-demo` were both given, and they are the two answers to one ' +
        'question. Pass one.\n',
    );
    return 1;
  }
  const demo = asFlag(parsed.values['demo'])
    ? true
    : asFlag(parsed.values['no-demo'])
      ? false
      : undefined;
  try {
    const result = await runInstall({
      ...(rest[0] === undefined ? {} : { dir: rest[0] }),
      cwd,
      modules: asList(parsed.values['module']),
      ...(asString(parsed.values['deployment']) === undefined
        ? {}
        : { deployment: asString(parsed.values['deployment'])! }),
      ...(asString(parsed.values['registry']) === undefined
        ? {}
        : { registry: asString(parsed.values['registry'])! }),
      ...(asString(parsed.values['topology']) === undefined
        ? {}
        : { topology: asString(parsed.values['topology'])! }),
      storefront: !asFlag(parsed.values['no-storefront']),
      ...(asString(parsed.values['storefront-dir']) === undefined
        ? {}
        : { storefrontDir: asString(parsed.values['storefront-dir'])! }),
      services: !asFlag(parsed.values['no-services']),
      ...(demo === undefined ? {} : { demo }),
      ...(asString(parsed.values['admin-email']) === undefined
        ? {}
        : { adminEmail: asString(parsed.values['admin-email'])! }),
      ...(asString(parsed.values['admin-password']) === undefined
        ? {}
        : { adminPassword: asString(parsed.values['admin-password'])! }),
      ...(asString(parsed.values['admin-first-name']) === undefined
        ? {}
        : { adminFirstName: asString(parsed.values['admin-first-name'])! }),
      ...(asString(parsed.values['admin-last-name']) === undefined
        ? {}
        : { adminLastName: asString(parsed.values['admin-last-name'])! }),
      ...(asString(parsed.values['revalidate-secret']) === undefined
        ? {}
        : { revalidateSecret: asString(parsed.values['revalidate-secret'])! }),
      dryRun: asFlag(parsed.values['dry-run']),
      // The pipeline's own output is the operator's: every step inherits the
      // descriptors, so what pnpm says is what they see, live.
      echo: (line: string) => void process.stdout.write(`${line}\n`),
    });
    return result.exitCode;
  } catch (error: unknown) {
    if (error instanceof InstallInputError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    if (error instanceof InstallHostError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    // The two commands this one composes keep their own classes and their own
    // codes: a refusal they make is theirs, and reporting it as this command's
    // would lose the class `instance-tree.md` §4 assigns it.
    if (error instanceof InstanceInputError || error instanceof StorefrontInputError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    if (error instanceof InstanceHostError || error instanceof StorefrontHostError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    if (error instanceof MissingInputsError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/**
 * `endora dev` — the argv half of an instance's `pnpm run dev:all`
 * (`specs/136-open-source-publication/` GAP-7, FR-060).
 *
 * The terminal's interrupt reaches this process and is forwarded: each layer
 * runs in a process group of its own, so the supervisor — not the terminal —
 * decides the order things stop in, and a backgrounded watcher inside a layer
 * is stopped with it. An interrupt is exit 0: the operator asked for the stop.
 */
async function runDevCommand(
  parsed: Parsed,
  rest: readonly string[],
  cwd: string,
): Promise<number> {
  if (rest.length > 0) {
    process.stderr.write(
      `endora: \`dev\` takes no argument; got ${rest.join(', ')}. Run it from the root of ` +
        `the instance, as \`pnpm run dev:all\`.\n`,
    );
    return 1;
  }
  const storefrontDir = asString(parsed.values['storefront-dir']);
  if (asFlag(parsed.values['no-storefront']) && storefrontDir !== undefined) {
    process.stderr.write(
      'endora: `--no-storefront` and `--storefront-dir` were both given, and they are two ' +
        'answers to one question. Pass one.\n',
    );
    return 1;
  }
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    return await runDev({
      cwd,
      storefront: asFlag(parsed.values['no-storefront']) ? false : storefrontDir,
      write: (line: string) => void process.stdout.write(`${line}\n`),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DevInputError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    if (error instanceof DevHostError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    throw error;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

export async function main(argv: readonly string[], cwd: string): Promise<number> {
  // The one thing that has to happen **before** the parse: `new storefront`
  // accepts a flag per input the reference storefront declares, and those names
  // are the storefront's. Keyed on the two leading tokens rather than on a
  // heuristic over the whole of argv, so the answer never depends on whether a
  // flag's *value* happens to read like a subcommand.
  let declaredInputFlags: readonly string[] = [];
  if (argv[0] === 'new' && argv[1] === 'storefront') {
    try {
      declaredInputFlags = await storefrontInputFlags(cwd);
    } catch (error: unknown) {
      if (error instanceof StorefrontHostError || error instanceof DeclarationLoadError) {
        process.stderr.write(`endora: ${error.message}\n`);
        return 2;
      }
      throw error;
    }
  }

  let parsed: Parsed;
  try {
    parsed = parse(argv, declaredInputFlags);
  } catch (error: unknown) {
    process.stderr.write(`endora: ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`Run \`endora --help\` for the flags this build accepts.\n`);
    return 1;
  }

  const [command, subject, ...rest] = parsed.positionals;
  if (asFlag(parsed.values['help']) || command === undefined) {
    process.stdout.write(USAGE);
    return command === undefined && !asFlag(parsed.values['help']) ? 1 : 0;
  }

  if (command === 'check') {
    return runCheckCommand(parsed, [subject, ...rest].filter((v) => v !== undefined), cwd);
  }

  if (command === 'install') {
    return runInstallCommand(parsed, [subject, ...rest].filter((v) => v !== undefined), cwd);
  }

  if (command === 'generate') {
    return runGenerateCommand(parsed, [subject, ...rest].filter((v) => v !== undefined), cwd);
  }

  if (command === 'dev') {
    return runDevCommand(parsed, [subject, ...rest].filter((v) => v !== undefined), cwd);
  }

  if (command !== 'new') {
    process.stderr.write(
      `endora: unknown command "${command}". This build provides \`new module\`, ` +
        `\`new instance\`, \`new storefront\`, \`install\`, \`generate\`, \`dev\` and \`check\`.\n`,
    );
    return 1;
  }
  if (subject === 'storefront') {
    return runNewStorefrontCommand(parsed, rest, cwd, declaredInputFlags);
  }
  if (subject === 'instance') {
    return runNewInstanceCommand(parsed, rest, cwd);
  }
  if (subject !== 'module') {
    process.stderr.write(
      `endora: unknown subject "${subject ?? '<none>'}" for \`new\`. This build provides ` +
        `\`new module\`, \`new instance\` and \`new storefront\`; the other generators named ` +
        `in the ` +
        `scaffolding contract are not delivered.\n`,
    );
    return 1;
  }

  const id = rest[0];
  if (rest.length > 1) {
    process.stderr.write(
      `endora: \`new module\` takes one id; got ${rest.length} (${rest.join(', ')}).\n`,
    );
    return 1;
  }

  try {
    const result = await runNewModule({
      ...(id === undefined ? {} : { id }),
      ...(asString(parsed.values['name']) === undefined
        ? {}
        : { name: asString(parsed.values['name']) }),
      ...(asString(parsed.values['description']) === undefined
        ? {}
        : { description: asString(parsed.values['description']) }),
      ...(asString(parsed.values['dir']) === undefined
        ? {}
        : { dir: asString(parsed.values['dir']) }),
      ...(asString(parsed.values['scope']) === undefined
        ? {}
        : { scope: asString(parsed.values['scope']) }),
      dependencies: asList(parsed.values['depends']),
      permissions: asList(parsed.values['permission']),
      actions: asList(parsed.values['action']),
      ...(asString(parsed.values['icon']) === undefined
        ? {}
        : { icon: asString(parsed.values['icon']) }),
      ...(asString(parsed.values['admin']) === undefined
        ? {}
        : { admin: asString(parsed.values['admin']) }),
      entities: asFlag(parsed.values['entities']),
      ports: asFlag(parsed.values['ports']),
      worker: asFlag(parsed.values['worker']),
      subscriber: asFlag(parsed.values['subscriber']),
      ...(asString(parsed.values['tenant-scope']) === undefined
        ? {}
        : { tenantScope: asString(parsed.values['tenant-scope']) }),
      ...(asString(parsed.values['activation-setting']) === undefined
        ? {}
        : { activationSetting: asString(parsed.values['activation-setting']) }),
      ...(asString(parsed.values['non-deactivatable']) === undefined
        ? {}
        : { nonDeactivatable: asString(parsed.values['non-deactivatable']) }),
      dryRun: asFlag(parsed.values['dry-run']),
      cwd,
    });

    if (result.dryRun) {
      process.stdout.write(`endora new module ${result.spec.id} — dry run, nothing written.\n\n`);
      for (const file of result.files) {
        process.stdout.write(`--- ${file.path}\n${file.content}\n`);
      }
      process.stdout.write(
        `--- package.json\n(rendered by the platform's manifest generator once the sources ` +
          `above are on disk; this command composes no field of it)\n\n`,
      );
    } else {
      process.stdout.write(`endora new module ${result.spec.id} — ${result.packageName}\n`);
      for (const file of result.files) {
        process.stdout.write(`  wrote ${file.path}\n`);
      }
      for (const written of result.renderedManifests) {
        process.stdout.write(`  rendered ${written}\n`);
      }
    }

    process.stdout.write(`\nNext steps, inside this repository:\n`);
    result.nextSteps.forEach((step, index) => {
      process.stdout.write(`  ${String(index + 1)}. ${step}\n`);
    });
    return 0;
  } catch (error: unknown) {
    if (error instanceof ScaffoldInputError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    if (error instanceof ScaffoldHostError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/**
 * Is this module the program the process was started to run?
 *
 * The comparison is between **realpaths**, and that is the whole content of the
 * function. A package manager does not invoke `dist/bin/endora.js` directly: it
 * links the `bin`, so `process.argv[1]` names the link — pnpm's shim execs
 * `node "$basedir/../@endora-commerce/cli/dist/bin/endora.js"`, a path running
 * through the `node_modules/@endora-commerce/cli` symlink into the
 * content-addressed store — while Node's ESM loader resolves a module URL to
 * its real location before evaluating it, so `import.meta.url` is the store
 * path. Comparing the two as written is therefore false for **every** consumer
 * who installed this package and true only in the checkout that developed it,
 * where nothing is linked. Measured on a `pnpm pack`ed tarball installed into a
 * scratch directory: `endora --help` printed nothing at all and exited 0.
 *
 * Both failure directions are worth naming. Answering *no* wrongly is the
 * silence above. Answering *yes* wrongly would run the program on `import
 * { main }`, which is what the `./` export exists for, so the negative case is
 * asserted as well.
 *
 * An `argv[1]` naming nothing on disk answers `false` rather than throwing:
 * `realpathSync` raises `ENOENT`, and an uncaught one here would turn a wrong
 * guess about the invocation into a crash before any command is dispatched.
 */
export function isDirectEntry(entry: string | undefined, moduleUrl: string): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.cwd());
}
