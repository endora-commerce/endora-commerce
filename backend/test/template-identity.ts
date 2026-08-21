/**
 * Which migration template this run's platform is, read off the tree (issue #289).
 *
 * The template is shared by every invocation on the machine that has the same
 * platform, and by construction none that has a different one — so what
 * "the same platform" means has to be *computed*, not assumed, and the answer
 * has to be wrong-proof in one direction: two trees that differ anywhere the
 * template can see must not agree here.
 *
 * So the inputs are the ordered migration class names — from
 * `src/db/configured-migrations.ts`, which is the order the ORM config itself
 * runs and carries the manifest graph's effect on it — plus the SHA-256 of
 * every file that writes into the template: every migration source, and the
 * declared seed sources below. `templateDigest` folds them; nothing here knows
 * about databases.
 *
 * **What it does not cover, deliberately.** A migration is free to call into
 * `src/`, and hashing everything reachable would rebuild the template on any
 * change to the backend at all. The rule the tree actually follows is that a
 * migration is self-contained SQL, and the two seed sources are the exception
 * that is declared rather than discovered. A seeding step added anywhere else
 * is invisible here — which is why `template-seed.ts` exists and says so.
 *
 * Everything below fails loudly rather than quietly returning less: a digest
 * over a partial read names a template that holds more than the digest says,
 * which is the defect this file exists to close.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { templateDigest, type TemplateInputs, type TemplateSource } from './run-isolation.js';

/** `backend/`, the root every recorded path is relative to. */
const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Where migrations live. Both are the roots `scripts/generate-composer.ts`
 * walks to emit `src/db/migrations-registry.generated.ts`; an overlay module
 * ships no migration (D-105), so there is no third one.
 */
const MIGRATION_ROOTS = ['src/db/migrations', 'src/modules'] as const;

/**
 * The files that seed a migrated template, beyond its migrations.
 *
 * Anything added here becomes part of the template's identity, so changing one
 * of these gives the next run a template of its own instead of a database
 * somebody else's branch seeded. A missing entry is a hard failure, not a
 * skipped input.
 */
export const TEMPLATE_SEED_SOURCES = [
  'test/template-seed.ts',
  'src/kernel/sales-channels/default-channel-reconciler.ts',
] as const;

async function migrationFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (absolute: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.name.endsWith('.ts')) {
        found.push(child);
      }
    }
  };
  for (const migrationRoot of MIGRATION_ROOTS) {
    const absolute = join(root, migrationRoot);
    if (migrationRoot === 'src/modules') {
      // Only the modules' own `migrations/` directories — walking all of
      // `src/modules` would fold every module's source into the digest and
      // rebuild the template on any backend change.
      const modules = await readdir(absolute, { withFileTypes: true }).catch(() => []);
      for (const module of modules) {
        if (module.isDirectory()) await walk(join(absolute, module.name, 'migrations'));
      }
    } else {
      await walk(absolute);
    }
  }
  return found.sort();
}

async function sha256Of(root: string, absolute: string): Promise<TemplateSource> {
  const content = await readFile(absolute);
  return {
    path: relative(root, absolute),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

export interface TemplateIdentityOptions {
  /**
   * `backend/` unless a test points this at a fixture tree. The refusals below
   * are the reason it is here: a proof that a partial read is refused has to
   * enter above the read (issue #130), not below it.
   */
  readonly root?: string;
  /** The configured order; read from `src/db/configured-migrations.ts` unless supplied. */
  readonly migrations?: readonly string[];
}

export interface TemplateIdentity extends TemplateInputs {
  readonly digest: string;
  /** For the log line: what was read, so a digest is never a number with no population behind it. */
  readonly migrationFiles: number;
}

/**
 * This run's template identity.
 *
 * Imported dynamically and only on the provisioning path: a run that declared
 * `BACKEND_TEST_SERVICES=none` reads no files and computes no digest, because
 * it provisions nothing.
 */
export async function templateIdentity(options: TemplateIdentityOptions = {}): Promise<TemplateIdentity> {
  const root = options.root ?? BACKEND_ROOT;
  const migrations =
    options.migrations ?? (await import('../src/db/configured-migrations.js')).MIGRATION_NAMES;
  const files = await migrationFiles(root);

  // The walk and the registry are independent derivations of the same
  // population, so they are reconciled rather than trusted: a walk that came
  // back short is a digest over less than the template holds, and the whole
  // point of the digest is that it cannot be over less than the template holds.
  if (files.length < migrations.length) {
    throw new Error(
      `[test-setup] found ${files.length} migration source file(s) under ` +
        `${MIGRATION_ROOTS.join(', ')} but the registry configures ${migrations.length} ` +
        `migration(s). Refusing to identify a migration template from a partial read — the ` +
        `template would hold more than its digest says, which is issue #289.`,
    );
  }

  const sources = await Promise.all(files.map((file) => sha256Of(root, file)));
  for (const declared of TEMPLATE_SEED_SOURCES) {
    const absolute = join(root, declared);
    try {
      sources.push(await sha256Of(root, absolute));
    } catch (error) {
      throw new Error(
        `[test-setup] the declared template seed source "${declared}" could not be read ` +
          `(${(error as Error).message}). It is part of what a template holds, so a run cannot ` +
          `identify one without it — fix the path in test/template-identity.ts.`,
      );
    }
  }

  const inputs: TemplateInputs = { migrations, sources };
  return {
    ...inputs,
    digest: templateDigest(inputs),
    migrationFiles: files.length,
  };
}
