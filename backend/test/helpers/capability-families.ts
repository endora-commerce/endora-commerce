import { expect } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import {
  REGISTERED_MANIFESTS,
  resolvedManifestEntries,
} from '../../src/lifecycle/registered-manifests.js';
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

/**
 * Every module declaring membership of `key`, in manifest order.
 *
 * For a test that wants "a PIM connector" rather than "this module's siblings" — and
 * that should not name one, for the same reason nothing else here does.
 */
export function declaredMembersOf(key: string): readonly string[] {
  return MANIFESTS.filter((manifest) => (manifest.capabilities ?? []).includes(key)).map(
    (manifest) => manifest.id,
  );
}

/**
 * The members of `key` in `deployment`'s **resolved** manifest set, sorted — and, of
 * those, the ones the deployment itself declares as overlay modules.
 *
 * For the files that prove a family's mechanism over real manifests
 * (`integration/pim_connector/*`). They compose the `example` deployment because its
 * overlay fixtures are the members that stay when every packaged member of the family
 * has left this repository (feature 134, T113, `research.md` D13 §6); `overlay` is what
 * lets a file assert that its population survives those departures, rather than
 * discovering it on `master` after the last one, where no merge-request pipeline runs
 * the integration tree (D-198).
 */
export async function deploymentFamilyOf(
  key: string,
  deployment: string,
): Promise<{ readonly members: readonly string[]; readonly overlay: readonly string[] }> {
  const entries = (
    await resolvedManifestEntries({ ...process.env, DEPLOYMENT: deployment })
  ).filter((entry) => (entry.manifest.capabilities ?? []).includes(key));
  const idsOf = (list: typeof entries): string[] =>
    list.map((entry) => entry.manifest.id).sort();
  return {
    members: idsOf(entries),
    overlay: idsOf(entries.filter((entry) => entry.origin === 'overlay')),
  };
}

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
 * Switch **every** member of `key` off, the subject included.
 *
 * `clearFamilyFor` deliberately leaves the subject alone, so that it can then be
 * switched on. A test whose subject is *being refused* needs the other thing: the
 * subject off as well, or it holds the claim itself and refuses the incumbent the test
 * was arranging. The suite shares one database across files, so a member left on by an
 * earlier file is a real state to arrange away rather than a hypothetical one — and it
 * is invisible in a single-file run, which is how it was missed.
 *
 * The population is the **composed** one — the capability registry the running handle
 * was built with — and not the core manifest index the other helpers here read. Under
 * `deployment: 'example'` the family includes the deployment's overlay members
 * (`pim_incumbent_fixture`, `ledger_vendor_fixture`, …), and "every member off" that
 * skipped them would leave an overlay member holding the claim (feature 134, T113).
 * Under bare core the two populations are the same set.
 */
export async function switchCapabilityFamilyOff(
  h: BackendServerHandle,
  key: string,
): Promise<readonly string[]> {
  const members = [...effectiveState.declaredMembersOfCapability(key)];
  for (const member of members) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${member}/activation`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { active: false },
    });
    expect(res.statusCode, `deactivating the family member '${member}': ${res.body}`).toBe(200);
  }
  return members;
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
