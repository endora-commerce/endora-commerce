#!/usr/bin/env node
/**
 * `endora` — the argv layer, and nothing else.
 *
 * Three properties are contract (`contracts/cli-surface.md` §1–§2):
 *
 *   * **`node:util`'s `parseArgs`**, so the program takes no dependency to read
 *     its own arguments, and an unrecognised flag is a refusal rather than a
 *     silent ignore.
 *   * **no interactivity.** A prompt is a dependency, and a value the tool
 *     invented is a value nobody reviewed. Every input the program cannot derive
 *     is on the command line.
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
import { runNewStorefront } from '../new-storefront/index.js';
import { StorefrontHostError, StorefrontInputError } from '../new-storefront/reference.js';

const USAGE = `endora — scaffolding and conformance tooling for Endora Commerce modules.

Usage:
  endora new module <id> --name <text> --description <text> [options]
  endora new storefront <dir> [--registry <url>] [--dry-run]
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
  <dir>                         where to write. Required; there is no default
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

function parse(argv: readonly string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
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
      registry: { type: 'string' },
      'dry-run': { type: 'boolean' },
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
): Promise<number> {
  if (rest.length > 1) {
    process.stderr.write(
      `endora: \`new storefront\` takes one directory; got ${String(rest.length)} ` +
        `(${rest.join(', ')}).\n`,
    );
    return 1;
  }
  try {
    const result = await runNewStorefront({
      ...(rest[0] === undefined ? {} : { dir: rest[0] }),
      ...(asString(parsed.values['registry']) === undefined
        ? {}
        : { registry: asString(parsed.values['registry'])! }),
      dryRun: asFlag(parsed.values['dry-run']),
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
    process.stdout.write(`\nNext steps:\n`);
    result.nextSteps.forEach((step, index) => {
      process.stdout.write(`  ${String(index + 1)}. ${step}\n`);
    });
    return 0;
  } catch (error: unknown) {
    if (error instanceof StorefrontInputError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 1;
    }
    if (error instanceof StorefrontHostError) {
      process.stderr.write(`endora: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

export async function main(argv: readonly string[], cwd: string): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(argv);
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

  if (command !== 'new') {
    process.stderr.write(
      `endora: unknown command "${command}". This build provides \`new module\`.\n`,
    );
    return 1;
  }
  if (subject === 'storefront') {
    return runNewStorefrontCommand(parsed, rest, cwd);
  }
  if (subject !== 'module') {
    process.stderr.write(
      `endora: unknown subject "${subject ?? '<none>'}" for \`new\`. This build provides ` +
        `\`new module\` and \`new storefront\`; the other generators named in the ` +
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
