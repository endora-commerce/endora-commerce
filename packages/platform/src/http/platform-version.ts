import { readFileSync } from 'node:fs';

/**
 * Which Endora Commerce release this process is — the platform package's own
 * version.
 *
 * **Why not `npm_package_version`.** That is what the health payload read, and
 * it answered `0.0.0` on every deployment there was, for two independent
 * reasons. It is the version of the *host application's* manifest, which says
 * `0.0.0` in the reference backend and in every instance `endora new` writes;
 * and it is set by a package manager running a script, so a container that
 * starts the server with `node dist/index.js` — which is every image this
 * repository and the scaffolder produce — has no such variable and got the
 * literal fallback instead. Releases are lockstep (one `fixed` group), so the
 * version of any one published package is the release, and this package is the
 * one that is the platform.
 *
 * **Why a file read and not an import.** `src/http/` and `dist/http/` sit at the
 * same depth, so `../../package.json` is this package's manifest from the
 * source tree and from the published artefact alike — npm always ships a
 * package's `package.json`, whatever its `files` list says. An `import … with
 * { type: 'json' }` would resolve the same file and move it under `rootDir`'s
 * judgement for nothing.
 *
 * Read once, at module load: the answer cannot change while the process lives.
 */

/** `MAJOR.MINOR.PATCH`, optionally with a pre-release or build suffix. */
const RELEASE_NUMBER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/**
 * The placeholder an unreleased manifest carries. It has the shape of a release
 * and is not one; reporting it is the defect this file replaced.
 */
const UNRELEASED = '0.0.0';

/**
 * `null` when the manifest cannot be read or does not carry a release number.
 * Exported with its argument for the test; production calls it with none.
 */
export function readPlatformVersion(
  manifest: URL = new URL('../../package.json', import.meta.url),
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'string') return null;
  if (version === UNRELEASED || !RELEASE_NUMBER.test(version)) return null;
  return version;
}

export const PLATFORM_VERSION: string | null = readPlatformVersion();
