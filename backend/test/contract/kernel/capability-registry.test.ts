import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T015 — the composed container's derived families are the members' own
 * declarations (feature 132, `contracts/module-capabilities.md` R6).
 *
 * **Both sides are derived, and that is the whole test.** A written-down expected
 * list is the next thing that goes stale (D-100) — it is precisely what
 * `PIM_CONNECTOR_MODULES` was, and what this feature exists to delete. So the
 * expectation is re-read from the resolved manifest index on every run, and a
 * connector that joins or leaves a family changes both sides in the same run,
 * with no test to edit. A fifth PIM connector is covered by existing.
 *
 * The **resolved** index rather than the generated core one: it is core plus this
 * deployment's overlay modules plus every installed Endora module package, which
 * is the population the composition root hands `loadModulePresence`, and the
 * whole point of the manifest field is that all three declare on identical terms
 * (R2.1).
 */

const RESOLVED_MANIFESTS = await resolvedManifestEntries();

/** Side A — who *says* they are in the family, read from their own manifests. */
function declaredMembers(key: string): string[] {
  return RESOLVED_MANIFESTS.filter((entry) =>
    (entry.manifest.capabilities ?? []).includes(key),
  )
    .map((entry) => entry.manifest.id)
    .sort();
}

/** Every capability key any resolved manifest mentions, on either side of the declaration. */
function declaredKeys(): string[] {
  const keys = new Set<string>();
  for (const entry of RESOLVED_MANIFESTS) {
    for (const key of entry.manifest.capabilities ?? []) keys.add(key);
    for (const owned of entry.manifest.exclusiveCapabilities ?? []) keys.add(owned.key);
  }
  return [...keys].sort();
}

describe('the composed container derives every family from the manifests [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers the PIM family with exactly the connectors that declared it', () => {
    const key = CAPABILITY_KEYS.PIM_CONNECTOR;
    expect([...effectiveState.declaredMembersOfCapability(key)].sort()).toEqual(
      declaredMembers(key),
    );
  });

  it('answers every other declared key the same way', () => {
    for (const key of declaredKeys()) {
      expect(
        [...effectiveState.declaredMembersOfCapability(key)].sort(),
        `capability ${key}`,
      ).toEqual(declaredMembers(key));
    }
  });

  it('names the owner of each exclusive key from that owner\'s own manifest', () => {
    for (const entry of RESOLVED_MANIFESTS) {
      for (const owned of entry.manifest.exclusiveCapabilities ?? []) {
        expect(effectiveState.exclusiveCapability(owned.key)).toEqual({
          key: owned.key,
          ownerModuleId: entry.manifest.id,
          errorCode: owned.errorCode,
        });
      }
    }
  });

  it('answers nothing for a key nobody in this tree declares', () => {
    expect(effectiveState.declaredMembersOfCapability('no-such-capability')).toEqual([]);
    expect(effectiveState.exclusiveCapability('no-such-capability')).toBeUndefined();
  });

  /**
   * The coverage guard. Every assertion above is satisfied by two empty sets, so
   * without this the file is green over a population it never had — which is the
   * failure mode a derived-on-both-sides test is otherwise perfectly shaped for.
   * It reds until the connectors declare `capabilities` (T020).
   */
  it('has a family to check at all — the PIM connectors declare their membership', () => {
    expect(declaredMembers(CAPABILITY_KEYS.PIM_CONNECTOR)).not.toEqual([]);
  });
});
