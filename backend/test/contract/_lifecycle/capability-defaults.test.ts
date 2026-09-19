import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { capabilityRegistryFrom } from '@endora-commerce/platform/composition';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';

/**
 * FR-016 / R3.6 over **this tree**, in both deployments it has
 * (`module-capabilities.md` R6 names this file).
 *
 * ## Why a whole-tree assertion as well as a derivation refusal
 *
 * `capabilityRegistryFrom` refuses a default-activated member at composition, which is
 * fail-closed and reaches a connector installed from npm that no check here walks. What
 * it does **not** do is tell an author before they boot: the refusal arrives as a
 * deployment that will not start. This says the same thing from the manifests, in
 * milliseconds, with no database — and it says it for the `example` deployment too,
 * which a bare-core run never composes.
 *
 * ## The rule is "none", not "at most one"
 *
 * R6's own table still says *"at most one member of each family declares
 * `activation.default: true`"*, which was D6's first version. The owner's ruling replaced
 * it: `resolveActivation` returns `Map<string, boolean>` and carries no provenance, so a
 * member that ships activated holds a claim nobody made whether it is the only one or
 * not. "At most one" caps a category error instead of removing it. This asserts the rule
 * as decided.
 *
 * ## Both sides derived
 *
 * The offender set is computed here from the manifests, and the platform's refusal is
 * invoked over the same list. Nothing is written down: a fifth connector, or a fourth
 * family, is covered without editing this file.
 */

/** Bare core, and the one deployment this repository ships an overlay for. */
const DEPLOYMENTS: readonly (NodeJS.ProcessEnv | undefined)[] = [
  undefined,
  { DEPLOYMENT: 'example' } as NodeJS.ProcessEnv,
];

const RESOLVED = await Promise.all(
  DEPLOYMENTS.map(async (env) => ({
    label: env?.['DEPLOYMENT'] ?? 'bare core',
    manifests: (await resolvedManifestEntries(env ?? process.env)).map((e) => e.manifest),
  })),
);

/** The members that ship activated into a key some installed module owns. */
function offenders(manifests: readonly ModuleManifest[]): string[] {
  const exclusiveKeys = new Set(
    manifests.flatMap((m) => (m.exclusiveCapabilities ?? []).map((e) => e.key)),
  );
  const found: string[] = [];
  for (const manifest of manifests) {
    const activation = manifest.activation;
    if (activation === undefined || 'nonDeactivatable' in activation) continue;
    if (activation.default !== true) continue;
    for (const key of manifest.capabilities ?? []) {
      if (exclusiveKeys.has(key)) found.push(`${manifest.id} (${key})`);
    }
  }
  return found.sort();
}

describe('no member of an exclusive capability ships activated [contract]', () => {
  it.each(RESOLVED.map((r) => r.label))('%s: the offender set is empty', (label) => {
    const resolved = RESOLVED.find((r) => r.label === label)!;
    expect(offenders(resolved.manifests)).toEqual([]);
  });

  it.each(RESOLVED.map((r) => r.label))(
    '%s: the platform derives the family without refusing',
    (label) => {
      // The same claim through the instrument that enforces it at boot, so this file
      // cannot drift from the refusal it stands in front of.
      const resolved = RESOLVED.find((r) => r.label === label)!;
      expect(() => capabilityRegistryFrom(resolved.manifests)).not.toThrow();
    },
  );

  it('had a population to judge — members, and exclusive keys for them to belong to', () => {
    // The vacuous-pass guard. Every assertion above is satisfied by a tree with no
    // families at all, which is what a broken manifest walk looks like.
    for (const { label, manifests } of RESOLVED) {
      const members = manifests.filter((m) => (m.capabilities ?? []).length > 0);
      const owners = manifests.filter((m) => (m.exclusiveCapabilities ?? []).length > 0);
      expect(members.length, `${label}: declared members`).toBeGreaterThan(3);
      expect(owners.length, `${label}: capability owners`).toBeGreaterThan(2);
    }
  });

  it('the example deployment contributes a member bare core does not', () => {
    // The overlay module is the reason this file walks two deployments: it is a member
    // of an exclusive family that only exists under `DEPLOYMENT=example`, and it shipped
    // `default: true` until this feature flipped it. A single-deployment assertion would
    // have passed over it.
    const bare = new Set(
      RESOLVED.find((r) => r.label === 'bare core')!.manifests.map((m) => m.id),
    );
    const overlayOnly = RESOLVED.find((r) => r.label === 'example')!
      .manifests.filter((m) => !bare.has(m.id) && (m.capabilities ?? []).length > 0)
      .map((m) => m.id);
    expect(overlayOnly.length).toBeGreaterThan(0);
  });
});
