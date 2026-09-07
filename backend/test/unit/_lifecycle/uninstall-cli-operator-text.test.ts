import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { platformSourceRootOf } from '../../../scripts/lib/platform-root.js';
import { nodeWorkspaceFs, workspaceMembers } from '../../../scripts/lib/workspace-packages.js';

/**
 * What `module:uninstall` tells the operator — D-69 (issue #145).
 *
 * Two sentences of the CLI are asserted here rather than by running it, because
 * running it is the thing this suite must not do: `module:uninstall` writes to
 * whatever database `DATABASE_URL` names, and issue #69 already removed the
 * contract cases that drove real state changes through these scripts. The
 * subject is therefore the command's own source.
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
 *
 * **Which file that source is moved in `specs/115-lifecycle-container-move/`
 * Phase 5, and re-pointing it is this file's own obligation.** The command
 * bodies — argv grammar, exit-code table, `mapError` and every sentence an
 * operator reads — are `@endora-commerce/platform/lifecycle`'s now (D115-1);
 * `backend/src/lifecycle/scripts/uninstall.ts` is twenty lines of ORM, Redis and
 * system scope and carries neither subject. A test that kept reading it would
 * have passed — `not.toMatch` over a file that no longer contains the sentence
 * is green for the wrong reason — which is why the vacuous-pass guards below
 * assert the positives as well, and why the platform root is derived from the
 * workspace rather than spelled.
 */

const platformRoot = platformSourceRootOf(
  workspaceMembers(fileURLToPath(new URL('../../../../', import.meta.url)), nodeWorkspaceFs()),
);
if (platformRoot === null) {
  throw new Error('no workspace member declares itself the platform — nothing to read');
}

const commandSource = (verb: string): string =>
  readFileSync(join(platformRoot, 'lifecycle', 'commands', `${verb}.ts`), 'utf8');

const uninstallSource = commandSource('uninstall');
const disableSource = commandSource('disable');

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
    // Two-way: the two commands report one refusal, so a change to either code
    // has to move both.
    expect(uninstallCase?.[1]).toBe(disableCase?.[1]);
  });

  it('prints the manifest hint, since there is no override flag to suggest', () => {
    expect(uninstallSource).toMatch(/non-deactivatable in its manifest/);
    expect(uninstallSource).toMatch(/there is no override flag/);
  });
});
