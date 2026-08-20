/**
 * The one derivation of "can an operator switch this module off?" (D-63/D-68).
 *
 * Two checks need it and neither may own it. `check-port-catches` reports a
 * `catch` as `OWNER LOCKED` when every gate it swallows belongs to a module the
 * orchestrator refuses to switch off; `check-entry-presence` leaves such a
 * module's boot hooks out of its population, because a hook cannot fail to
 * decide a presence that has no off state. Both answers rest on the same fact —
 * the module's manifest declares `activation.nonDeactivatable` — and both are
 * only safe if the fact is **read at check time** rather than written down: an
 * owner who withdraws a lock must re-red every site that was resting on it, in
 * the same run, with no ledger to edit. A hand-maintained list would go stale
 * silently, which is the failure mode two-way ledgers exist to prevent. D-68
 * says so explicitly — "the two checks share one helper in
 * `backend/scripts/lib/`" — and this is that helper.
 *
 * `lockedOwners` is pure and takes the manifests, so each check's red proofs can
 * drive the classification from a fixture that enters at the top of the
 * analysis. `loadLockedOwners` is the one place that knows where the generated
 * index lives; it **refuses an empty index** rather than returning an empty set,
 * because "no module is locked" and "the index did not load" would otherwise be
 * the same answer — and the second silently changes both checks' verdicts while
 * looking like a normal run (issue #113).
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The part of a manifest this derivation reads. Structural rather than
 * `ModuleManifest`, so a fixture can supply the two fields it looks at and
 * nothing else.
 */
export interface ManifestActivationInput {
  readonly id: string;
  readonly activation?:
    | {
        readonly settingCode?: string;
        readonly default?: boolean;
        readonly nonDeactivatable?: boolean;
        readonly reason?: string;
      }
    | undefined;
}

/** Raised when the manifest index could not be read, or read as empty. */
export class ManifestIndexUnreadableError extends Error {
  override readonly name = 'ManifestIndexUnreadableError';
}

/** The modules the orchestrator refuses to switch off, on either axis. */
export function lockedOwners(
  manifests: readonly ManifestActivationInput[],
): ReadonlySet<string> {
  return new Set(
    manifests
      .filter((manifest) => manifest.activation?.nonDeactivatable === true)
      .map((manifest) => manifest.id),
  );
}

/** A module an operator can switch off — the complement of the locked set. */
export function isSwitchableModule(moduleId: string, locked: ReadonlySet<string>): boolean {
  return !locked.has(moduleId);
}

/**
 * Read the manifests out of the generated index under `srcRoot`.
 *
 * Throws `ManifestIndexUnreadableError` when the index is missing or empty; a
 * caller turns that into exit 2, never into a pass.
 */
export async function loadManifestActivations(
  srcRoot: string,
): Promise<readonly ManifestActivationInput[]> {
  const indexPath = join(srcRoot, 'modules/_lifecycle/manifest-index.generated.ts');
  let entries: ReadonlyArray<{ id: string; manifest: { activation?: unknown } }>;
  try {
    const loaded = (await import(pathToFileURL(indexPath).href)) as {
      DISCOVERED_MANIFESTS?: ReadonlyArray<{ id: string; manifest: { activation?: unknown } }>;
    };
    entries = loaded.DISCOVERED_MANIFESTS ?? [];
  } catch (err: unknown) {
    throw new ManifestIndexUnreadableError(`${indexPath} could not be imported: ${String(err)}`);
  }
  if (entries.length === 0) {
    throw new ManifestIndexUnreadableError(`${indexPath} declared no modules`);
  }
  return entries.map((entry) => ({
    id: entry.id,
    activation: entry.manifest.activation as ManifestActivationInput['activation'],
  }));
}

/** The locked set, straight from the generated index. */
export async function loadLockedOwners(srcRoot: string): Promise<ReadonlySet<string>> {
  return lockedOwners(await loadManifestActivations(srcRoot));
}
