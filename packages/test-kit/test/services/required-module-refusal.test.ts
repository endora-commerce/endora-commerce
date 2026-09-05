import { describe, expect, it } from 'vitest';

import { composeTestServer } from '@endora-commerce/test-kit/server';

import {
  FIXTURE_MANIFESTS,
  REQUIRED_MODULE_ID,
  REQUIRED_MODULE_REASON,
  fixtureModuleEntry,
  fixtureOrm,
  requiredModuleEntry,
} from './fixture-platform.js';

/**
 * T024 / R2.4 — a composition missing a required module is refused **with the
 * platform's own sentence**.
 *
 * ## Why this is the proof the kit most needs
 *
 * A stranger's first composition is the one most likely to be incomplete: the
 * required set is 23 modules and their transitive closures, so "just my module"
 * is not a composition anybody can run. What that person must get back is the
 * platform's refusal — the module's id, the sentence *its own manifest* gives
 * for why the platform cannot run without it, and a remedy — because a
 * paraphrase written in the kit would be a second answer to a question the
 * platform already answers, and it would go stale the first time the refusal
 * gained a case.
 *
 * So the assertions below are about **provenance** as much as about content:
 * the message must carry the manifest's own reason, which the kit never sees
 * as prose and could not have invented.
 *
 * ## And it must be refused before anything half-runs
 *
 * `composeModules` asks this before the first module registers (issue #258),
 * which is what makes the alternative so bad: without it the platform does not
 * degrade, it exits, in whichever module's boot hook happens to need the absent
 * one first — naming the wrong module and offering no remedy.
 */
describe('a composition missing a required module', () => {
  it('is refused with the platform’s sentence, naming the module, the reason and a remedy', async () => {
    const failure = await composeTestServer({
      composition: {
        // The required module is left out. Everything else is the fixture
        // platform exactly as the other files compose it.
        modules: [fixtureModuleEntry] as never,
        orm: fixtureOrm(),
        manifests: FIXTURE_MANIFESTS,
      },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    const error = failure as Error;
    // The platform's own error type, not one the kit wrapped it in.
    expect(error.name).toBe('RequiredModuleAbsentError');
    const message = error.message;
    expect(message).toContain(REQUIRED_MODULE_ID);
    // The manifest's own sentence. The kit has no other way to produce this
    // string, which is what makes it evidence that the refusal is the
    // platform's.
    expect(message).toContain(REQUIRED_MODULE_REASON);
    // A remedy, which is the half a bare "missing module" message lacks.
    expect(message).toMatch(/remedy:/);
    // The classification the platform makes: declared by the manifests, and
    // registered by no module.
    expect(
      (error as { findings?: readonly { kind: string; moduleId: string }[] }).findings,
    ).toEqual([{ kind: 'not-composed', moduleId: REQUIRED_MODULE_ID, reason: REQUIRED_MODULE_REASON }]);
  });

  it('composes when the required module is there, so the refusal is about the module and not the fixture', async () => {
    const handle = await composeTestServer({
      composition: {
        modules: [requiredModuleEntry, fixtureModuleEntry] as never,
        orm: fixtureOrm(),
        manifests: FIXTURE_MANIFESTS,
      },
    });
    try {
      expect(handle.composed.sink.plugins.length).toBeGreaterThan(0);
    } finally {
      const { teardownTestServer } = await import('@endora-commerce/test-kit/server');
      await teardownTestServer(handle);
    }
  });
});
