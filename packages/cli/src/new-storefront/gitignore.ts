/**
 * The scaffolded storefront's `.gitignore`, rendered for the tree
 * `endora new storefront` writes.
 *
 * The reference storefront's own `.gitignore` was written for a directory
 * **inside this repository**, whose root `.gitignore` already covers `.env`, the
 * installed trees and the build output — so it names none of them. A scaffolded
 * storefront is a repository of its own (D-195), and the same run writes
 * `REVALIDATE_SECRET`, the bearer token of the public `app/api/revalidate`
 * route, into `.env`: copied unchanged, that file let the client's first
 * `git add .` commit the secret. The rendered `.dockerignore` already kept it
 * out of the image; this keeps it out of the history.
 *
 * The reference file's own entries are kept verbatim, below the ones this
 * scaffold adds, so an entry the storefront gains there reaches every future
 * copy without this file being edited.
 */

/** What every scaffolded storefront ignores, whatever the reference file says. */
const SCAFFOLD_ENTRIES: readonly string[] = [
  '# This storefront\'s own configuration. `.env` holds REVALIDATE_SECRET — the',
  '# bearer token of `app/api/revalidate` — and must never be committed;',
  '# `.env.example` is the file to commit.',
  '.env',
  '.env*.local',
  '',
  '# Installed and built trees.',
  'node_modules/',
  '.next/',
  '*.tsbuildinfo',
];

/**
 * @param reference the reference storefront's own `.gitignore`, or `null` when
 *   it has none.
 */
export function storefrontGitignore(reference: string | null): string {
  const own = reference === null ? '' : reference.replace(/\s+$/, '');
  return `${[...SCAFFOLD_ENTRIES, ...(own === '' ? [] : ['', own])].join('\n')}\n`;
}
