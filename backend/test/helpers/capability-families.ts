import { expect } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../src/lifecycle/registered-manifests.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Putting a module's capability families out of its way, **derived** (feature 132).
 *
 * ## Why this helper exists
 *
 * The harness activates every module whatever its manifest says, so on a composed
 * handle every member of every exclusive family holds a claim. A test that wants to
 * switch one member on therefore has to switch the others off first — which is
 * correct, and is what an operator does.
 *
 * What is *not* correct is writing down which the others are. Several fixtures did:
 * `prepareUnopimModule` switched off `pim_ergonode` and nothing else, under a comment
 * saying mutual exclusion is operator-axis, because at the time the family held
 * exactly two modules and Ergonode was the other one. The moment the family became
 * four, that fixture was a hand-written copy of a derived fact that had gone stale —
 * D-100's shape, one level out from the arrays this feature deleted, and it failed in
 * the tree the fast suite does not reach.
 *
 * So the population comes from the manifests, on every call: the keys the subject
 * declares, and the other modules declaring those keys. A fifth connector is handled
 * by existing.
 *
 * ## Why it is not `__setEnabledForTesting`
 *
 * Because the tests that need it are testing the **route**. Seeding the cache
 * directly would put presence into a state no operator could have reached and would
 * skip the audited Command, the propagation and the refresh that the route performs —
 * and two of the callers are asserting exactly those. Deactivation is never refused
 * by the exclusion seam (`capability-exclusivity.md` R2.4), so the route is always
 * available for this.
 */

const MANIFESTS: readonly ModuleManifest[] = REGISTERED_MANIFESTS.map((entry) => entry.manifest);

/** The capability keys `moduleId` declares membership of. Empty for most modules. */
export function capabilityKeysOf(moduleId: string): readonly string[] {
  return MANIFESTS.find((manifest) => manifest.id === moduleId)?.capabilities ?? [];
}

/**
 * Every other module that declares one of `moduleId`'s keys — the modules whose
 * activation would refuse it.
 */
export function familySiblingsOf(moduleId: string): readonly string[] {
  const keys = new Set(capabilityKeysOf(moduleId));
  if (keys.size === 0) return [];
  return MANIFESTS.filter(
    (manifest) =>
      manifest.id !== moduleId &&
      (manifest.capabilities ?? []).some((key) => keys.has(key)),
  ).map((manifest) => manifest.id);
}

/**
 * Switch every sibling of `moduleId` off through the activation route, so that
 * `moduleId` can be switched on without meeting a claim.
 *
 * A no-op for a module in no family, which is most of them — so a caller may call it
 * unconditionally rather than asking first.
 */
export async function clearFamilyFor(
  h: BackendServerHandle,
  moduleId: string,
): Promise<readonly string[]> {
  const siblings = familySiblingsOf(moduleId);
  for (const sibling of siblings) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${sibling}/activation`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { active: false },
    });
    // Deactivation is never refused by the exclusion seam (R2.4). A non-200 here is
    // a different failure and must not be swallowed into a confusing 409 later.
    expect(res.statusCode, `deactivating the family sibling '${sibling}': ${res.body}`).toBe(200);
  }
  return siblings;
}
