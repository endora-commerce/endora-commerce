import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What `module:uninstall` tells the operator — D-69 (issue #145).
 *
 * Two sentences of the CLI are asserted here rather than by running it, because
 * running it is the thing this suite must not do: `module:uninstall` writes to
 * whatever database `DATABASE_URL` names, and issue #69 already removed the
 * contract cases that drove real state changes through these scripts. The
 * subject is therefore the script's own source.
 *
 * 1. The soft-uninstall banner used to promise "re-installing this module will
 *    restore configuration", printed immediately before the sweep in
 *    `orchestrator.ts` deleted every Setting the module owns. AGENTS.md pins
 *    that asymmetry as deliberate — a pause keeps the operator's activation
 *    choice, a soft uninstall resets it to the manifest default — so a CLI
 *    saying the opposite is how the design gets "fixed" by someone later.
 * 2. `mapError` had no `non-deactivatable` case, so the refusal D-69 adds would
 *    have fallen through to the generic exit 70 and read as an internal error
 *    rather than a decision.
 */

const uninstallSource = readFileSync(
  fileURLToPath(new URL('../../../src/modules/_lifecycle/scripts/uninstall.ts', import.meta.url)),
  'utf8',
);
const disableSource = readFileSync(
  fileURLToPath(new URL('../../../src/modules/_lifecycle/scripts/disable.ts', import.meta.url)),
  'utf8',
);

describe('module:uninstall — the soft-uninstall banner', () => {
  it('does not promise that a re-install brings the configuration back', () => {
    expect(uninstallSource.length).toBeGreaterThan(0);
    expect(uninstallSource).not.toMatch(/restore (configuration|data|settings)/i);
  });

  it('says the settings are gone and names the operation that keeps them', () => {
    expect(uninstallSource).toMatch(/recreates them from the manifest defaults/);
    expect(uninstallSource).toMatch(/Use module:disable to pause a module/);
  });
});

describe('module:uninstall — the non-deactivatable refusal', () => {
  it('exits 77, the code the disable path already uses for the same refusal', () => {
    const uninstallCase = /case 'non-deactivatable':[\s\S]{0,200}?return (\d+);/.exec(
      uninstallSource,
    );
    const disableCase = /case 'non-deactivatable':[\s\S]{0,200}?return (\d+);/.exec(disableSource);

    expect(uninstallCase?.[1]).toBe('77');
    // Two-way: the two scripts report one refusal, so a change to either code
    // has to move both.
    expect(uninstallCase?.[1]).toBe(disableCase?.[1]);
  });

  it('prints the manifest hint, since there is no override flag to suggest', () => {
    expect(uninstallSource).toMatch(/non-deactivatable in its manifest/);
    expect(uninstallSource).toMatch(/there is no override flag/);
  });
});
