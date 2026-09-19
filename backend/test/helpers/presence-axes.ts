import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting, effectiveState } from '@endora-commerce/platform/kernel';
import { registryCache } from '@endora-commerce/platform/composition';

/**
 * Arranging the two presence axes independently, for a test that asserts they are
 * **reported** separately.
 *
 * ## Why this is not in `off-state.ts`
 *
 * It looks like it belongs there, and `check:off-state-coverage` is the reason it does not.
 * That check reconciles the off-state harness's **exported functions** against the two
 * seams its predicate recognises — `expectModuleAbsent` and `withModuleOff` — and refuses
 * the whole run when the count goes short, precisely so that it never silently judges two
 * seams out of three. Exporting this from there made it refuse, correctly:
 *
 *     the walk opened 116 file(s) and covered 2 of the 3 unit(s) `harness-exports` derives
 *     — it is reading a residue of its population, not the population
 *
 * The repair is **not** to add this name to `HARNESS_NAMES`. That list is what counts as a
 * module having off-state coverage, and this function asserts nothing — it only arranges
 * state. Registering it would credit a test with coverage it does not have, which is the
 * "green for a reason other than nothing being wrong" family this repository spends most of
 * its review effort on.
 */
/**
 * Seed the **platform** axis off for `moduleId` while its **operator** axis stays on, so a
 * test can assert that the two are reported separately.
 *
 * ## Why this needs a helper at all
 *
 * `__setEnabledForTesting(ids)` seeds the operator axis only for the ids it is given, so a
 * module left out of the list has no stored activation value and falls back to its
 * **manifest default**. Three off-state tests relied on that fallback being `true` to get
 * "platform off, operator on" — the one combination that makes the Admin UI's distinction
 * between *"not installed here"* and *"we turned it off"* visible. When feature 132 flipped
 * those three connectors to `default: false` (FR-017), the fallback became `false`, both
 * axes read off, and the case stopped distinguishing anything while still passing its first
 * two assertions.
 *
 * So the operator axis is **arranged** here rather than inherited: an explicit
 * `global_value = true` row, then `__refreshActivationForTesting`, which is the same seam
 * the activation route's propagation uses. A test that says what it needs cannot be
 * changed by a default moving underneath it.
 */
export async function withPlatformAxisOffOnly(opts: {
  readonly em: () => EntityManager;
  readonly moduleId: string;
  /** Every module id the cache should hold — the caller's `ALL_IDS`. */
  readonly allModuleIds: readonly string[];
}): Promise<void> {
  const settingCode = effectiveState.activationSettingCode(opts.moduleId);
  if (settingCode === null) {
    throw new Error(
      `'${opts.moduleId}' declares no activation control, so it has no operator axis to ` +
        'keep on — this helper is for a module that does.',
    );
  }

  await opts
    .em()
    .nativeUpdate(Setting, { code: settingCode }, { globalValue: true });

  // Platform axis: everything except the subject. This resets the operator axis, which is
  // why the refresh below has to come after it.
  registryCache.__setEnabledForTesting(
    opts.allModuleIds.filter((id) => id !== opts.moduleId),
  );
  await registryCache.__refreshActivationForTesting(opts.em);
}
