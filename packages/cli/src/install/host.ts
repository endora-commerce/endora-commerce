/**
 * The temporary host `endora install` provisions when nothing of ours is
 * installed beside the target (`specs/080-f4-real-scope/rulings.md` D-271).
 *
 * ## Why it exists
 *
 * `endora new instance` reads the platform's and every module's manifest off
 * the packages installed **beside** the target or the working directory
 * (`new-instance/host.ts`), because the module set is a derivation over those
 * manifests and nothing in it can be read without installing it. Under `npx`
 * the CLI lives in npx's cache, which is above neither directory, so the front
 * door refused F6 before it had derived anything.
 *
 * ## What it is, and what it is not
 *
 * A fresh directory under the OS temp directory — never inside or above the
 * target, for the reason the acceptance criterion's `provisionHost` gives: a
 * `node_modules` above the instance would let its own install resolve a package
 * it never declared. It holds a `package.json` declaring every package of this
 * CLI's release index at its indexed version, the `.npmrc` `--registry` writes
 * (the same writer, `new-storefront/npmrc.ts`), and whatever `<runner> install`
 * puts there. The install verb then calls `runNewInstance` with the host as its
 * working directory, so **every resolution stays where it was**: the host is a
 * place for `resolveInstanceHost` to look, and this file installs packages,
 * resolves no module and decides no member (125 FR-143).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseReleaseIndex, type ReleaseIndex } from '../lib/release-index.js';
import { InstanceHostError } from '../new-instance/host.js';
import { npmrcContent, normalizeRegistry } from '../new-storefront/npmrc.js';

/** The prefix of the host's directory name under the OS temp directory. */
export const HOST_DIRECTORY_PREFIX = 'endora-install-host-';

/**
 * This CLI's release index, or `null` with the reason it could not be read.
 *
 * `null` rather than a throw of this module's own: the install verb decides
 * which class the refusal is reported under, and it is exit 2 — an input the
 * run could not read, exactly as a module manifest it could not read is F7.
 */
export function readReleaseIndex(
  file: string,
): { readonly index: ReleaseIndex } | { readonly problem: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error: unknown) {
    return {
      problem: `${file} could not be read (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  try {
    return { index: parseReleaseIndex(text, file) };
  } catch (error: unknown) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The host's `.npmrc`, or `null` when no `--registry` was given.
 *
 * The writer is the one `endora new instance --registry` uses, so the host and
 * the instance it writes name one endpoint keyed one way. A value that is not a
 * registry is **F5**, the class `new instance` reports it under, decided here
 * because the host is installed before `new instance` is called.
 */
export function hostNpmrc(registry: string | undefined, scope: string): string | null {
  if (registry === undefined) return null;
  try {
    return npmrcContent(normalizeRegistry(registry), [scope.slice(0, -1)]);
  } catch (error: unknown) {
    throw new InstanceHostError('F5', error instanceof Error ? error.message : String(error));
  }
}

/** Write the host's manifest and `.npmrc` into `dir`, which the caller created. */
export function writeHost(dir: string, index: ReleaseIndex, npmrc: string | null): void {
  const dependencies = Object.fromEntries(
    index.packages.map((entry) => [entry.name, entry.version] as const),
  );
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'endora-install-host',
        version: '0.0.0',
        private: true,
        description:
          'A temporary directory `endora install` reads the release\'s packages from. ' +
          'Removed when the install succeeds; safe to delete.',
        dependencies,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  if (npmrc !== null) writeFileSync(join(dir, '.npmrc'), npmrc, 'utf8');
}
