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
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { TOKEN_VARIABLE } from './npmrc.js';
import {
  memberDirectories,
  resolveReference,
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
}

export interface NewStorefrontResult {
  readonly reference: StorefrontReference;
  readonly targetDir: string;
  readonly plan: StorefrontPlan;
  readonly dryRun: boolean;
  readonly nextSteps: readonly string[];
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

  if (options.dryRun === true) {
    return { reference, targetDir, plan, dryRun: true, nextSteps: nextSteps(targetDir, plan) };
  }

  for (const file of plan.files) {
    const target = join(targetDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    if (file.content !== null) writeFileSync(target, file.content, 'utf8');
    else writeFileSync(target, readFileSync(file.source!));
  }

  return {
    reference,
    targetDir,
    plan,
    dryRun: false,
    nextSteps: nextSteps(targetDir, plan),
  };
}

function refuseOccupiedDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) return;
  const entries = readdirSync(targetDir);
  if (entries.length === 0) return;
  throw new StorefrontInputError(
    `${targetDir} exists and is not empty (${entries.slice(0, 5).join(', ')}). This command ` +
      `never merges into a directory: it is not idempotent over an existing storefront, and ` +
      `pretending otherwise would silently discard hand-written code.`,
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
function nextSteps(targetDir: string, plan: StorefrontPlan): readonly string[] {
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
  return [
    install,
    `set PUBLIC_API_BASE_URL (and the rest of .env.example) to the backend this storefront ` +
      `talks to. Nothing in the copy points at a backend.`,
    `pnpm run build — it runs \`themes:generate\`, \`next build\` and \`check:themes\`.`,
    `this storefront is yours now. There is no kit to upgrade and no shell to keep in step: a ` +
      `fix to the platform reaches you through \`@endora-commerce/contracts\`, where a wire ` +
      `change is a compile error rather than a runtime surprise.`,
  ];
}

export { StorefrontHostError, StorefrontInputError };
