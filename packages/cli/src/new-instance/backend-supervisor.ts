/**
 * The backend's supervising parent, as an instance is scaffolded with it (issue
 * #596).
 *
 * ## What it is
 *
 * `backend/scripts/supervise.mjs` in the platform repository: the image's
 * command, which runs the compiled API as its child and exits non-zero once
 * the child stops answering, so `restart: unless-stopped` brings the container
 * back. It is the second copy of the storefront's (#152), and the platform
 * repository's `backend/test/unit/ci/backend-supervisor.test.ts` holds the two
 * identical outside their profile blocks.
 *
 * ## Why it is carried rather than rendered
 *
 * Every other file of an instance is rendered from a string in this package;
 * this one is ~400 lines of process logic whose single statement is that file,
 * and a third spelling of it here would be the copy nothing holds to the other
 * two. So it is carried: this package's `build` copies it into
 * `dist/{@link PACKAGED_SUPERVISOR_FILE}` (`scripts/write-backend-supervisor.mjs`),
 * and `prepack` refuses a tarball without it. A run from a checkout's `src` —
 * the tests — reads the repository's own file, four directories above this one.
 *
 * In an instance it is the client's file, as the deployment examples are: the
 * image example names it and nothing reads it back.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where the supervisor sits, in the platform repository and in an instance alike. */
export const BACKEND_SUPERVISOR_PATH = 'backend/scripts/supervise.mjs';

/** The carried copy, under this package's `dist`. */
export const PACKAGED_SUPERVISOR_FILE = 'backend-supervisor.mjs';

/** The CLI was built somewhere the supervisor could not be copied from. */
export class BackendSupervisorMissingError extends Error {
  constructor(tried: readonly string[]) {
    super(
      `the backend supervisor is not carried by this CLI build (looked at ${tried.join(', ')}). ` +
        'Rebuild @endora-commerce/cli in a checkout of the platform repository.',
    );
    this.name = 'BackendSupervisorMissingError';
  }
}

/**
 * The supervisor's bytes, read from the carried copy, else from the checkout.
 *
 * Both candidates are addressed relative to this module, which sits at
 * `<cli>/{src,dist}/new-instance/`: the carried copy is `../<file>` from `dist`,
 * and the repository's own is `../../../../backend/scripts/supervise.mjs` from
 * either, accepted only when the directory between is this package and the
 * directory above is a pnpm workspace — so a published CLI never reads whatever
 * happens to sit four levels above its `node_modules` entry.
 */
export function backendSupervisorSource(moduleUrl: string = import.meta.url): string {
  const packaged = fileURLToPath(new URL(`../${PACKAGED_SUPERVISOR_FILE}`, moduleUrl));
  const checkout = fileURLToPath(new URL(`../../../../${BACKEND_SUPERVISOR_PATH}`, moduleUrl));
  const ownManifest = fileURLToPath(new URL('../../package.json', moduleUrl));
  const workspace = fileURLToPath(new URL('../../../../pnpm-workspace.yaml', moduleUrl));
  if (existsSync(packaged)) return readFileSync(packaged, 'utf8');
  if (existsSync(checkout) && existsSync(workspace) && isThisPackage(ownManifest)) {
    return readFileSync(checkout, 'utf8');
  }
  throw new BackendSupervisorMissingError([packaged, checkout]);
}

function isThisPackage(manifestPath: string): boolean {
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown };
    return typeof manifest.name === 'string' && manifest.name.endsWith('/cli');
  } catch {
    return false;
  }
}
