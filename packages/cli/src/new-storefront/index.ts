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
  const plan = planStorefront(reference, members, targetDir);

  if (options.dryRun === true) {
    return { reference, targetDir, plan, dryRun: true, nextSteps: nextSteps(targetDir, plan.ranges.length) };
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
    nextSteps: nextSteps(targetDir, plan.ranges.length),
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
 */
function nextSteps(targetDir: string, published: number): readonly string[] {
  return [
    `cd ${targetDir} && pnpm install — the ${String(published)} \`@endora-commerce/*\` ` +
      `${published === 1 ? 'range is' : 'ranges are'} published semver now. Until this repository publishes them, install them from packed tarballs ` +
      `(\`pnpm pack\` in each package, then a \`pnpm.overrides\` entry per package) — which is ` +
      `what this command's own acceptance criterion does.`,
    `set PUBLIC_API_BASE_URL (and the rest of .env.example) to the backend this storefront ` +
      `talks to. Nothing in the copy points at a backend.`,
    `pnpm run build — it runs \`themes:generate\`, \`next build\` and \`check:themes\`.`,
    `this storefront is yours now. There is no kit to upgrade and no shell to keep in step: a ` +
      `fix to the platform reaches you through \`@endora-commerce/contracts\`, where a wire ` +
      `change is a compile error rather than a runtime surprise.`,
  ];
}

export { StorefrontHostError, StorefrontInputError };
