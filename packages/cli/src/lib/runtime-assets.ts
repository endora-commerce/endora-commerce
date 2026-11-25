/**
 * "Does this file ship?" — the runtime-asset classification, as this CLI asks it
 * (`specs/190-overlay-full-modules/` T013, FR-013).
 *
 * ## One owner, carried
 *
 * The question has one owner since D-218: `scripts/lib/runtime-assets.mjs` at the
 * platform repository's root, in plain JavaScript, because a module package's build asks
 * it under bare `node` and the application's `copy-runtime-assets.ts` asks it too. A
 * second spelling here would be two readers able to disagree about one directory — one
 * shipping a file the other refuses — which is the defect D-218 closed.
 *
 * `endora build overlays` needs it in an instance, where that file does not exist. So it
 * is **carried**, the backend supervisor's arrangement (`../new-instance/backend-supervisor.ts`):
 * this package's `build` copies it into `dist/{@link PACKAGED_RUNTIME_ASSETS_FILE}`
 * (`scripts/write-runtime-assets.mjs`) and `prepack` refuses a tarball without it. A run
 * from a checkout's `src` — the tests — imports the repository's own file. The owner stays
 * where it is, so no build order changes: the platform and every module package still
 * build without this CLI.
 *
 * It is loaded rather than imported, because the specifier differs between the two
 * places; the type below is the owner's `.d.mts`, narrowed to what a caller here needs, and
 * `runtime-assets.test.ts` holds the loaded module to every function the owner exports.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The carried copy, under this package's `dist`. */
export const PACKAGED_RUNTIME_ASSETS_FILE = 'runtime-assets.mjs';

/** Where the owner sits in the platform repository. */
const OWNER_PATH = 'scripts/lib/runtime-assets.mjs';

export type AssetClassification = 'asset' | 'fixture' | 'ignored' | 'unclassified';

export interface CollectedAssets {
  /** Files to copy, relative to the source root, sorted. */
  readonly assets: readonly string[];
  /** Files whose extension is in neither list — a refusal. */
  readonly unclassified: readonly string[];
  /** Files that would ship but sit beside a test: a fixture, reported (D-218). */
  readonly fixtures: readonly string[];
  /** Every file the walk saw. */
  readonly scanned: number;
}

/** The owner's surface (`scripts/lib/runtime-assets.d.mts`), as this package calls it. */
export interface RuntimeAssets {
  readonly RUNTIME_ASSET_EXTENSIONS: readonly string[];
  classifyAssetFile(fileName: string, siblings: readonly string[]): AssetClassification;
  collectRuntimeAssets(root: string): CollectedAssets;
  copyRuntimeAssets(srcRoot: string, outRoot: string, assets: readonly string[]): unknown;
  auditCopiedAssets(outRoot: string, assets: readonly string[]): unknown;
  isTestFileName(fileName: string): boolean;
  extensionOf(fileName: string): string;
}

/** The CLI was built somewhere the classification could not be carried from. */
export class RuntimeAssetsMissingError extends Error {
  constructor(tried: readonly string[]) {
    super(
      `the runtime-asset classification is not carried by this CLI build (looked at ` +
        `${tried.join(', ')}). Rebuild @endora-commerce/cli in a checkout of the platform ` +
        'repository.',
    );
    this.name = 'RuntimeAssetsMissingError';
  }
}

/**
 * The classification module: the carried copy, else the checkout's owner.
 *
 * Both candidates are addressed relative to this module, which sits at
 * `<cli>/{src,dist}/lib/`: the carried copy is `../<file>` from `dist`, and the owner is
 * `../../../../scripts/lib/runtime-assets.mjs` from either, accepted only when the
 * directory between is this package and the directory above is a pnpm workspace — so a
 * published CLI never imports whatever sits four levels above its `node_modules` entry.
 */
export async function loadRuntimeAssets(moduleUrl: string = import.meta.url): Promise<RuntimeAssets> {
  const packaged = fileURLToPath(new URL(`../${PACKAGED_RUNTIME_ASSETS_FILE}`, moduleUrl));
  const owner = fileURLToPath(new URL(`../../../../${OWNER_PATH}`, moduleUrl));
  const ownManifest = fileURLToPath(new URL('../../package.json', moduleUrl));
  const workspace = fileURLToPath(new URL('../../../../pnpm-workspace.yaml', moduleUrl));
  const chosen = existsSync(packaged)
    ? packaged
    : existsSync(owner) && existsSync(workspace) && isThisPackage(ownManifest)
      ? owner
      : null;
  if (chosen === null) throw new RuntimeAssetsMissingError([packaged, owner]);
  return (await import(pathToFileURL(chosen).href)) as RuntimeAssets;
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
