/**
 * `@endora-commerce/platform/env` resolves, and what it resolves to is a
 * declaration (feature 117, FR-001; `environment-inputs.md` §R2.1).
 *
 * ## Why this file exists at all
 *
 * `check:env-inputs` reads the platform's declaration out of its **source
 * text**, deliberately: importing an emitted artefact would answer about the
 * previous build, which is the `stale-artefact` class
 * `check:action-route-permissions` had to grow a refusal for. That decision
 * leaves the `exports` subpath with **no reader in this repository** — and a
 * published surface nothing mounts is a promise to a consumer that nobody
 * kept, which is exactly what `check:admin-zones` calls `unrendered-zone` one
 * surface over.
 *
 * So this is the mount point. The subpath is how a *client's* CLI and
 * `endora doctor` reach the declaration of the platform version they actually
 * installed — R2.1's whole reason for putting it on the map — and a wrong
 * target, a build that stopped emitting it or a barrel that stopped exporting
 * the array would otherwise be discovered by a client rather than by this
 * pipeline.
 *
 * It asserts nothing about *which* inputs are declared. That is
 * `check:env-inputs`' question, it is answered against the reads rather than
 * against a list, and a count here would be a derived fact written down
 * (D-100).
 */
import { describe, expect, it } from 'vitest';

import { EnvironmentInputSchema } from '@endora-commerce/contracts';

describe('the platform publishes its environment-input declaration', () => {
  it('resolves the `./env` subpath and exports the declaration', async () => {
    const module = (await import('@endora-commerce/platform/env')) as {
      PLATFORM_ENVIRONMENT_INPUTS?: unknown;
    };
    expect(Array.isArray(module.PLATFORM_ENVIRONMENT_INPUTS)).toBe(true);
    expect((module.PLATFORM_ENVIRONMENT_INPUTS as unknown[]).length).toBeGreaterThan(0);
  });

  it('publishes entries the contract shape accepts', async () => {
    const { PLATFORM_ENVIRONMENT_INPUTS } = (await import('@endora-commerce/platform/env')) as {
      PLATFORM_ENVIRONMENT_INPUTS: readonly unknown[];
    };
    for (const entry of PLATFORM_ENVIRONMENT_INPUTS) {
      const parsed = EnvironmentInputSchema.safeParse(entry);
      expect(
        parsed.success,
        parsed.success ? '' : JSON.stringify(parsed.error?.issues ?? []),
      ).toBe(true);
    }
  });
});
