/**
 * Types for `runtime-assets.mjs`, and nothing else.
 *
 * The implementation is plain JavaScript because a module package's build step
 * runs under bare `node` (see that file's header). This declaration carries no
 * value: the extension lists, the walk and the copy all live once, next door.
 * `backend/scripts/lib/runtime-assets.ts` re-exports through it, and
 * `backend/test/unit/scripts/runtime-assets.test.ts` exercises the real
 * functions over the real tree — so a declaration that drifted from the
 * implementation would fail on a value, not merely fail to type.
 */

/** One asset, as a path relative to the root it was found under (POSIX). */
export type AssetPath = string;

export interface CollectedAssets {
  /** Files to copy, relative to the source root, sorted. */
  assets: AssetPath[];
  /**
   * Files whose extension is in neither list. A non-empty array is a refusal:
   * whoever added the file knows whether the application opens it, and nobody
   * downstream does.
   */
  unclassified: AssetPath[];
  /**
   * Files that would ship but sit in a directory holding a test, so they are a
   * test's fixture and not a runtime asset (D-218). Reported rather than
   * silently dropped: a genuine asset parked beside a test is the one thing
   * this classification can now get wrong, and its author is the reader.
   */
  fixtures: AssetPath[];
  /** Every file the walk saw, `.ts` and ruled-out kinds included. */
  scanned: number;
}

export declare const RUNTIME_ASSET_EXTENSIONS: readonly string[];
export declare const NON_RUNTIME_EXTENSIONS: Readonly<Record<string, string>>;
export declare function extensionOf(fileName: string): string;
export declare function isTestFileName(fileName: string): boolean;
export type AssetClassification = 'asset' | 'fixture' | 'ignored' | 'unclassified';
/**
 * `siblings` is required rather than defaulted, deliberately: it makes a caller
 * that has not been taught about D-218 a `tsc` error instead of a walk that
 * quietly ships fixtures again.
 */
export declare function classifyAssetFile(
  fileName: string,
  siblings: readonly string[],
): AssetClassification;
export declare function collectRuntimeAssets(root: string): CollectedAssets;
export declare function copyRuntimeAssets(
  srcRoot: string,
  outRoot: string,
  assets: readonly AssetPath[],
): number;
export declare function auditCopiedAssets(
  outRoot: string,
  assets: readonly AssetPath[],
): AssetPath[];
