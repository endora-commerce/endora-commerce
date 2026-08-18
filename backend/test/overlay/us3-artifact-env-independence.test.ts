import { describe, expect, it } from 'vitest';
import { renderAll } from '../../scripts/generate-composer.js';
import { coveredArtifactPaths } from '../../scripts/check-overlay-determinism.js';

/**
 * T-E — every generated artefact renders identically with and without
 * `DEPLOYMENT` set (D-104).
 *
 * This is the issue-#120 ruling applied to the family it was missed in. Before
 * D-104, `manifest-index.generated.ts` was rendered from a walk that read
 * `DEPLOYMENT`, so the committed file — the bare-core render — reported STALE on
 * **every** run that set the variable, while no run that left it unset looked at
 * the deployment at all. Measured on `master` at 432455a3:
 *
 *     $ DEPLOYMENT=example pnpm --filter backend run overlay:check
 *     [overlay:check] composition.generated: up-to-date and deterministic ✓
 *     [overlay:check] manifest-index: committed file is STALE at …
 *     exit 1
 *
 * And `composition.generated` read clean there only because `example_overlay`
 * shipped no `backend.ts`. Giving it one — which D-103 requires — would have put
 * a second artefact into the permanently-stale set. An artefact that is always
 * stale for a deployment is one nobody can use to detect a genuinely stale one.
 *
 * The comparison is over the **rendered** content rather than over the check's
 * exit code, so a regression is reported as the artefact that moved rather than
 * as a failed subprocess.
 */
describe('T-E — the generated artefacts are environment-independent', () => {
  it('renders every artefact byte-identically with and without DEPLOYMENT=example', async () => {
    const before = process.env['DEPLOYMENT'];
    let withDeployment: ReadonlyArray<{ label: string; content: string }>;
    try {
      process.env['DEPLOYMENT'] = 'example';
      withDeployment = (await renderAll()).map(({ label, content }) => ({ label, content }));
    } finally {
      if (before === undefined) delete process.env['DEPLOYMENT'];
      else process.env['DEPLOYMENT'] = before;
    }

    const bareCore = (await renderAll()).map(({ label, content }) => ({ label, content }));

    // Non-vacuity: four artefacts, and a render that found nothing would
    // compare two empty strings equal.
    expect(bareCore).toHaveLength(4);
    for (const artefact of bareCore) expect(artefact.content.length).toBeGreaterThan(0);

    expect(withDeployment).toEqual(bareCore);
  });

  it('imports nothing from a deployment tree, in any committed artefact', async () => {
    // The **code**, not the prose: `entities-registry`'s header explains why an
    // entity under `src/apps/` is refused, and a substring search over the whole
    // file matches that sentence. Same lesson the `overlay: true` case learned —
    // assert on what the generator emits, not on what it says about itself.
    for (const { label, content } of await renderAll()) {
      const imports = content
        .split('\n')
        .filter((line) => line.startsWith('import ') || line.startsWith('  { id:'));
      expect(imports.length, `${label} emitted nothing`).toBeGreaterThan(0);
      for (const line of imports) {
        expect(line, `${label} names a deployment tree`).not.toContain('/apps/');
        expect(line, `${label} names the example overlay module`).not.toContain(
          'example_overlay',
        );
      }
    }
  });

  it('covers the same artefacts whichever way the environment is set', () => {
    const before = process.env['DEPLOYMENT'];
    try {
      process.env['DEPLOYMENT'] = 'example';
      const withDeployment = coveredArtifactPaths();
      delete process.env['DEPLOYMENT'];
      expect(withDeployment).toEqual(coveredArtifactPaths());
    } finally {
      if (before === undefined) delete process.env['DEPLOYMENT'];
      else process.env['DEPLOYMENT'] = before;
    }
  });
});
