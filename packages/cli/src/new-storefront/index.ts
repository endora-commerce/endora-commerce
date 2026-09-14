/**
 * `endora new storefront <dir>` — the command.
 *
 * It copies the reference storefront out of this repository into a directory the
 * client then owns outright, rewrites every declaration that names something
 * above the storefront's own directory, and **forgets it** (D-195). There is no
 * kit, no shell and no channel back to what it wrote: a scaffold that kept one
 * would be a kit wearing a different name.
 *
 * The order is `endora new module`'s and for the same reason: **validate
 * completely, then write**. A half-written storefront is worse than none — it
 * installs against ranges nothing resolves, its configuration extends a file it
 * does not have, and the author's next command is a manual clean-up.
 *
 * Exit codes are `contracts/cli-surface.md` §2's, unchanged: `0` it did what it
 * was asked, `1` a refusal the author can act on, `2` an input it could not
 * read. The three refusal classes map cleanly — a target directory that is
 * occupied and an outward reference no rule classifies are `1`; a checkout with
 * no reference storefront in it is `2`.
 *
 * ## It resolves the copy's environment inputs, in four tiers
 *
 * `specs/117-instance-bring-up/` FR-010…FR-015. The storefront declares what it
 * needs (`storefront/environment-inputs.mjs`) and this command resolves each of
 * those in one fixed order — an explicit flag, then a `.env` already placed in
 * the target directory, then a prompt on a terminal, then a refusal naming
 * **every** missing input at once — and writes the answers into the copy's own
 * `.env`. The values are the operator's or they are asked for; nothing is
 * invented, and the run says so in a provenance line whose `defaulted=` is
 * contract-bound to `0`.
 *
 * FR-014 is why it is here and not only in `endora new instance`: one product
 * means one behaviour, and the resolution is one shared module rather than a
 * copy per command. This command already exists and already has a customer, and
 * three of its required inputs are three of the four facts nothing reconciles
 * across the trees today.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { scopeToMembers, type EnvironmentInput } from '@endora-commerce/contracts';

import { loadTreeDeclaration } from '../inputs/declaration.js';
import { parseEnvFile, writeEnvFile } from '../inputs/env-file.js';
import { promptForInputs, type PromptIo } from '../inputs/prompt.js';
import {
  flagFor,
  generateSecret,
  interactivityOf,
  missingInputsRefusal,
  planResolution,
  provenanceLine,
  type ResolvedInput,
} from '../inputs/resolve.js';
import { TOKEN_VARIABLE } from './npmrc.js';
import {
  addressVariables,
  ENV_EXAMPLE_FILE,
  memberDirectories,
  resolveReference,
  STOREFRONT_DECLARATION_EXPORT,
  StorefrontHostError,
  StorefrontInputError,
  type StorefrontReference,
} from './reference.js';
import { planStorefront, type StorefrontPlan } from './rewrite.js';

export interface NewStorefrontOptions {
  /** Where to write. Required: this command has no default target. */
  readonly dir?: string | undefined;
  /** Report what would be written and what each rewrite becomes; write nothing. */
  readonly dryRun?: boolean | undefined;
  /**
   * The registry the scaffolded storefront installs from.
   *
   * Absent writes no `.npmrc`, which is what a consumer of the public registry
   * holds, and is deliberately the default so that the path this command takes
   * unasked is the destination rather than the rehearsal.
   */
  readonly registry?: string | undefined;
  readonly cwd?: string | undefined;
  /**
   * Values supplied on the command line — tier 1, keyed by variable name.
   *
   * Keyed by the **variable**, not by the flag: `flagFor` derives the flag from
   * the name, so a storefront that declares a variable this build has never
   * heard of is still supplied by `--its-own-name` with nothing here to update.
   */
  readonly inputs?: Readonly<Record<string, string | undefined>> | undefined;
  /** Force the refusal even on a terminal, for reproducibility (R3.4). */
  readonly nonInteractive?: boolean | undefined;
  /** Where a prompt is asked. Injected so a test drives it without a pty. */
  readonly promptIo?: PromptIo | undefined;
}

/** Raised when required inputs are missing and this run may not ask (R7.2). */
export class MissingInputsError extends Error {
  override readonly name = 'MissingInputsError';
}

export interface NewStorefrontResult {
  readonly reference: StorefrontReference;
  readonly targetDir: string;
  readonly plan: StorefrontPlan;
  readonly dryRun: boolean;
  readonly nextSteps: readonly string[];
  /** Every input this run answered for, with where each answer came from. */
  readonly resolved: readonly ResolvedInput[];
  /** R2.1's one line, printed by the caller. */
  readonly provenance: string;
  /**
   * Under `--dry-run`, what the run *would* have asked for and generated
   * (R2.4). Empty otherwise, because a real run did it rather than planning it.
   */
  readonly wouldPrompt: readonly string[];
  readonly wouldGenerate: readonly string[];
  /** Declared, in scope, and legitimately left unset — an optional nobody set. */
  readonly unset: readonly string[];
}

export async function runNewStorefront(
  options: NewStorefrontOptions,
): Promise<NewStorefrontResult> {
  const cwd = options.cwd ?? process.cwd();
  if (options.dir === undefined || options.dir.trim().length === 0) {
    throw new StorefrontInputError(
      `\`new storefront\` takes the directory to write, and has no default. The reference ` +
        `storefront is this repository's own application; a command that defaulted the target ` +
        `would either overwrite it or invent a name nobody chose.`,
    );
  }
  const reference = resolveReference(cwd);
  const targetDir = isAbsolute(options.dir) ? options.dir : resolve(cwd, options.dir);

  refuseOccupiedDirectory(targetDir);
  if (targetDir === reference.dir || targetDir.startsWith(reference.dir + sep)) {
    throw new StorefrontInputError(
      `${targetDir} is inside the reference storefront this command copies. A scaffold written ` +
        `there would be a copy of itself, and the copy would be part of its own population on ` +
        `the next run.`,
    );
  }

  const members = memberDirectories(reference.repoRoot);
  const plan = planStorefront(reference, members, targetDir, {
    ...(options.registry === undefined ? {} : { registry: options.registry }),
  });

  // Validate completely, then write — and the inputs are part of "completely".
  // A tree written before the refusal would be a storefront on disk that cannot
  // build, which is the half-written state this command's whole order exists to
  // avoid.
  const dryRun = options.dryRun === true;
  const interactivity = interactivityOf({
    nonInteractive: options.nonInteractive === true,
    dryRun,
  });
  const declared = await loadTreeDeclaration(reference.dir, STOREFRONT_DECLARATION_EXPORT);
  const resolution = planResolution({
    declared,
    // `endora new storefront` writes exactly one member. An input read only by
    // the admin or only by the backend is out of this run's population — not
    // resolved, not asked for, not refused — which is
    // `specs/118-instance-member-selection/`'s scoping, applied to the command
    // that has one member today so that it is already right for the command
    // that has three tomorrow.
    members: ['storefront'],
    flags: options.inputs ?? {},
    envFile: readTargetEnv(targetDir),
    interactivity,
    language: 'en',
  });

  if (resolution.missing.length > 0) {
    throw new MissingInputsError(missingInputsRefusal(resolution.missing, interactivity));
  }

  if (dryRun) {
    // R2.4 / R7.3 — a dry run resolves and reports; it prompts nothing and
    // generates nothing, and it names each input it would have had to ask for.
    // Its purpose is to be inspectable before it is trusted, and a dry run that
    // stopped to ask for a password is not inspectable.
    return {
      reference,
      targetDir,
      plan,
      dryRun: true,
      nextSteps: nextSteps(targetDir, plan, declared, resolution.resolved),
      resolved: resolution.resolved,
      provenance: provenanceLine(resolution.resolved),
      wouldPrompt: resolution.toPrompt.map((input) => input.name),
      wouldGenerate: resolution.toGenerate.map((input) => input.name),
      unset: resolution.unset.map((input) => input.name),
    };
  }

  const answered = await promptForInputs(
    resolution.toPrompt,
    'en',
    options.promptIo ?? { input: process.stdin, output: process.stdout },
  );
  const generated: ResolvedInput[] = resolution.toGenerate.map((input) => ({
    name: input.name,
    value: generateSecret(),
    provenance: 'generated' as const,
  }));
  const resolved = [...resolution.resolved, ...answered, ...generated];

  for (const file of plan.files) {
    const target = join(targetDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    if (file.content !== null) writeFileSync(target, file.content, 'utf8');
    else writeFileSync(target, readFileSync(file.source!));
  }
  writeResolvedEnv(targetDir, resolved);

  return {
    reference,
    targetDir,
    plan,
    dryRun: false,
    nextSteps: nextSteps(targetDir, plan, declared, resolved),
    resolved,
    provenance: provenanceLine(resolved),
    wouldPrompt: [],
    wouldGenerate: [],
    unset: resolution.unset.map((input) => input.name),
  };
}

/**
 * The flags this build accepts for the reference storefront's declared inputs,
 * without their leading dashes.
 *
 * The argv layer calls this **before** it parses, so `parseArgs` keeps
 * `strict: true` and an unrecognised flag stays a refusal
 * (`cli-surface.md` §1). The alternative — parsing leniently for this one
 * subcommand — would trade a typo'd `--next-public-api-base-ur` from a loud
 * refusal into a silently unset required input, which is the whole class of
 * failure this feature exists to remove.
 *
 * It is derived from the declaration rather than written down, so a storefront
 * that declares a variable this build has never heard of is supplied by its own
 * flag with nothing here to update (D-100).
 */
export async function storefrontInputFlags(cwd: string): Promise<readonly string[]> {
  return (await storefrontDeclaredInputs(cwd)).map((input) => flagFor(input.name).slice(2));
}

/**
 * The reference storefront's own declaration, scoped to the one member this
 * command writes.
 *
 * Exported because a caller that has to *supply* these inputs needs the same
 * population the command will *demand*, and deriving it twice is two answers
 * waiting to disagree — which is exactly how the acceptance criterion came to
 * invoke this command with none of them. The scoping is `planResolution`'s and
 * is applied here so that the two cannot part company either: an input read only
 * by the admin or only by the backend is out of this command's population, so it
 * is out of a supplier's too.
 *
 * The requirement is deliberately **not** filtered here. `isRequiredGiven` reads
 * a conditional requirement against the values a run has in hand, so which
 * inputs are required is a property of the invocation rather than of the
 * declaration, and answering it here would answer it for one invocation and be
 * wrong for the next.
 */
export async function storefrontDeclaredInputs(
  cwd: string,
): Promise<readonly EnvironmentInput[]> {
  const reference = resolveReference(cwd);
  const declared = await loadTreeDeclaration(reference.dir, STOREFRONT_DECLARATION_EXPORT);
  return scopeToMembers(declared, ['storefront']);
}

/** The file the copy's own runtime configuration lives in. */
const ENV_FILE = '.env';

/**
 * Tier 2 — the `.env` **of the target directory**, never of the working
 * directory and never of an ancestor (R1.2).
 *
 * That restriction is the whole of the rule: a command run inside a checkout of
 * ours must not silently inherit that checkout's development configuration,
 * which is how a client's first instance would come to carry
 * `postgresql://b2b:b2b@localhost:5432/b2b`.
 */
function readTargetEnv(targetDir: string): ReadonlyMap<string, string> {
  const path = join(targetDir, ENV_FILE);
  if (!existsSync(path)) return new Map();
  return parseEnvFile(readFileSync(path, 'utf8'));
}

/**
 * The answers, into the copy's own `.env`.
 *
 * R4.2 — a generated secret is written **where the operator can read it**,
 * change it and copy it into a secret store. It is named in the provenance line
 * and its value is printed nowhere.
 *
 * The file the operator may already have placed here is merged into rather than
 * rewritten: its comments, its ordering and its own keys survive.
 */
function writeResolvedEnv(targetDir: string, resolved: readonly ResolvedInput[]): void {
  const path = join(targetDir, ENV_FILE);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const values = new Map(resolved.map((entry) => [entry.name, entry.value] as const));
  writeFileSync(path, writeEnvFile(existing, values), 'utf8');
}

/**
 * The target must be empty — **or hold nothing but a `.env`**.
 *
 * The exception is the owner's own second tier, in their own words: *"I invoke a
 * command and I can attach arguments, **or place the required things in a
 * `.env` beforehand**"*. Without it tier 2 is unreachable for this command,
 * because the only directory it accepts is one that can hold no file at all —
 * which would leave `input-resolution.md` §1's four tiers implemented as three
 * and the operator's cheapest path refused by the command that documents it.
 *
 * It stays one file rather than "a few harmless ones". Everything else this
 * command would write over is either hand-written code or a copy of the
 * reference, and merging into either is the silent discard the refusal exists
 * for; a `.env` is neither, being the one file whose contents this command reads
 * *before* it writes and merges into rather than replaces.
 */
function refuseOccupiedDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) return;
  const entries = readdirSync(targetDir);
  if (entries.length === 0) return;
  if (entries.length === 1 && entries[0] === ENV_FILE) return;
  throw new StorefrontInputError(
    `${targetDir} exists and is not empty (${entries.slice(0, 5).join(', ')}). This command ` +
      `never merges into a directory: it is not idempotent over an existing storefront, and ` +
      `pretending otherwise would silently discard hand-written code. A directory holding ` +
      `nothing but a \`${ENV_FILE}\` is the one exception — that file is where you may place ` +
      `the values this command would otherwise ask you for.`,
  );
}

/**
 * The steps that are the author's.
 *
 * It never runs them, for `endora new module`'s reason: a scaffold that ran the
 * consuming project's tooling would be a channel back to the instance, and D-195
 * is that there is none.
 *
 * **The first step is about the registry, and it changed with publication**
 * (feature 104, § 1.5). It used to tell its reader to pack tarballs and pin them
 * through `pnpm.overrides`, which was honest while nothing under `packages/` was
 * published and became wrong the moment something was — instructions in a copy a
 * client owns outright are not something anybody comes back to correct.
 */
function nextSteps(
  targetDir: string,
  plan: StorefrontPlan,
  declared: readonly EnvironmentInput[],
  resolved: readonly ResolvedInput[],
): readonly string[] {
  const published = plan.ranges.length;
  const ranges = `the ${String(published)} \`@endora-commerce/*\` ${
    published === 1 ? 'range' : 'ranges'
  }`;
  const install =
    plan.registry === null
      ? `cd ${targetDir} && pnpm install — ${ranges} in the manifest are published semver and ` +
        `resolve at the public npm registry, which is what this command assumes when it is not ` +
        `told otherwise. If your instance installs them from a private registry, scaffold again ` +
        `with \`--registry <url>\`: it writes the \`.npmrc\` for you, with the token as an ` +
        `environment reference and never as a value.`
      : `cd ${targetDir} && export ${TOKEN_VARIABLE}=… && pnpm install — the \`.npmrc\` this ` +
        `command wrote points ${ranges} at ${plan.registry}. The file holds no secret: the ` +
        `token is \${${TOKEN_VARIABLE}}, expanded at install time, so commit the file and keep ` +
        `the value in your environment. If a fetch reports that a package "is not in the npm ` +
        `registry", read the last line of pnpm's output before believing it — the registry ` +
        `answers an expired credential with 404, in the same words it uses for a package that ` +
        `genuinely does not exist.`;
  // The names are the copy's own declaration, never a pair written here: this
  // step used to name `PUBLIC_API_BASE_URL`, which nothing in the storefront
  // reads, and the fetchers fall back to `http://localhost:3001` in silence — so
  // an author who followed it had a storefront talking to nothing in particular
  // and no error anywhere to say so.
  //
  // **It is `addressOf`, not the shape of the value in `.env.example`.** That
  // was the derivation until `NEXT_PUBLIC_SITE_URL` was supplied there, at which
  // point a predicate reading *absolute `http(s)` URL* would have swept the
  // shop's **own** public address into this sentence and told its owner it
  // "names the backend this storefront talks to" — in a file they own outright
  // and nobody comes back to correct.
  const backendVariables = addressVariables(declared, 'backend');
  // Which of those the run already answered. The step below stops telling an
  // author to set a value that is already in the file this command wrote:
  // instructions in a copy the client owns outright are not something anybody
  // comes back to correct, so a stale one stays wrong for the life of the shop.
  const answered = new Set(resolved.map((entry) => entry.name));
  // Next's own convention, not ours: a `NEXT_PUBLIC_` variable is inlined into
  // the client bundle by `next build`, so setting it afterwards changes nothing
  // a browser sees. Saying which of the copy's variables that is costs a prefix
  // test and saves the author a rebuild they would otherwise discover.
  const baked = backendVariables.filter((name) => name.startsWith('NEXT_PUBLIC_'));
  const unanswered = backendVariables.filter((name) => !answered.has(name));
  const backendStep = (): string =>
    unanswered.length === 0
      ? `check ${ENV_FILE} — this command wrote it, and every value in it is one you supplied ` +
        `on the command line, one you had already put there, or one you were asked for. ` +
        `${backendVariables.length === 0 ? '' : `${backendVariables.join(' and ')} name the ` +
          `backend this storefront talks to; change ${
            backendVariables.length === 1 ? 'it' : 'them'
          } there. `}Nothing in it was invented — a generated secret is named in the ` +
        `\`[inputs] resolved:\` line above and its value is in the file, never on your screen.`
      : `set ${unanswered.join(' and ')} (and the rest of ${ENV_EXAMPLE_FILE}) to the ` +
        `backend this storefront talks to. Its fetchers fall back to a compiled-in address when ` +
        `the environment names none, so an instance that sets none of them talks to that ` +
        `address rather than refusing.${baked.length === 0 ? '' : ` Next inlines ${baked.join(
          ' and ',
        )} into the browser bundle at build time, so set ${
          baked.length === 1 ? 'it' : 'them'
        } before \`pnpm run build\` rather than after.`}`;
  return [
    install,
    backendStep(),
    `pnpm run build — it runs \`themes:generate\`, \`next build\` and \`check:themes\`.`,
    // Baseline step E4 (`specs/125-first-mile-install/spec.md` §2.3), which was
    // printed nowhere: `storefront/package.json` has declared `start` all
    // along, and a client who followed this block to the end had a built
    // storefront and no command to serve it with.
    `pnpm run start — the built storefront, served. \`pnpm run dev\` is the other one: the ` +
      `same pages, rebuilt as you edit them, and the only one of the two that does not need a ` +
      `build first.`,
    `this storefront is yours now. There is no kit to upgrade and no shell to keep in step: a ` +
      `fix to the platform reaches you through \`@endora-commerce/contracts\`, where a wire ` +
      `change is a compile error rather than a runtime surprise.`,
  ];
}

export { StorefrontHostError, StorefrontInputError };
