/**
 * `specs/176-command-hooks-outbox/` T031 (FR-026) — a command hook is a
 * divergence of its own kind, `command-hook`, keyed
 * `command-hook:<module>:<action>#<id>`: one module may register several hooks
 * on one action, and each carries its own reason.
 *
 * Pure over `deriveDivergence`, so the fixture overlay source enters at the top
 * of the analysis.
 */
import { describe, expect, it } from 'vitest';

import { deriveDivergence, type DivergenceInput } from '../src/lib/divergence.js';
import { renderDivergenceMarkdown } from '../src/lib/divergence-artefacts.js';

const SOURCE = `
import { ORGANIZATION_HOOKABLE_ACTIONS as ORG, hookableAction } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';

const LOCAL = hookableAction('widget.create', 'widget', ['beforeCommit']);

export function registerModule(ctx: ModuleContext): void {
  ctx.commandHooks([
    { id: 'refuse-unserved-country', on: ORG.register, phase: 'beforeCommit', handler: () => undefined },
    { id: 'stamp-erp-code', on: ORG.create, phase: 'beforeCommit', handler: () => undefined },
    { id: 'literal-ref', on: { action: 'organization.admin_patch', objectType: 'organization', phases: ['beforeCommit'] }, phase: 'beforeCommit', handler: () => undefined },
    { id: 'computed', on: LOCAL, phase: 'beforeCommit', handler: () => undefined },
  ]);
}
`;

function input(reasons: Record<string, string> = {}): DivergenceInput {
  return {
    deployment: 'acme',
    overlayRoot: 'backend/src/apps/acme/modules',
    overlayModules: ['acme_erp'],
    sources: [{ moduleId: 'acme_erp', file: 'backend/src/apps/acme/modules/acme_erp/backend.ts', text: SOURCE }],
    routes: new Map(),
    owners: new Map(),
    rootSupplied: new Set(),
    actionOwners: new Map([
      ['organization.register', 'organizations'],
      ['organization.create', 'organizations'],
      ['organization.admin_patch', 'organizations'],
    ]),
    declaration: { omittedModules: [], decorationOrder: {}, reasons },
    seams: ['commandHooks'],
  };
}

describe('the `command-hook` divergence kind (176 T031)', () => {
  it('records each hook as command-hook:<module>:<action>#<id>, owned by the action’s owner, on rung 2', () => {
    const { report } = deriveDivergence(input());
    const hooks = report.entries.filter((entry) => entry.kind === 'command-hook');
    expect(hooks.map((entry) => entry.key)).toEqual([
      'command-hook:acme_erp:organization.admin_patch#literal-ref',
      'command-hook:acme_erp:organization.create#stamp-erp-code',
      'command-hook:acme_erp:organization.register#refuse-unserved-country',
    ]);
    expect(hooks[2]).toMatchObject({
      module: 'acme_erp',
      subject: 'organization.register',
      owner: 'organizations',
      rung: 2,
      detail: { kind: 'command-hook', phase: 'beforeCommit', id: 'refuse-unserved-country' },
    });
    expect(report.boundary.recorded).toContain('command-hook');
  });

  it('reports a ref it cannot resolve to an action as computed-subject, never as a skip', () => {
    const { findings } = deriveDivergence(input());
    expect(findings.filter((finding) => finding.kind === 'computed-subject').map((finding) => finding.detail)).toEqual([
      expect.stringContaining('commandHooks'),
    ]);
  });

  it('asks for one reason per hook, and a reason keyed by the hook clears it', () => {
    const { findings } = deriveDivergence(
      input({
        'command-hook:acme_erp:organization.register#refuse-unserved-country':
          'Refuses a registration from a country this client does not serve, before anything is written.',
      }),
    );
    const undeclared = findings.filter((finding) => finding.kind === 'undeclared-divergence').map((finding) => finding.detail);
    expect(undeclared.some((detail) => detail.includes('organization.register#refuse-unserved-country'))).toBe(false);
    expect(undeclared.some((detail) => detail.includes('organization.create#stamp-erp-code'))).toBe(true);
  });

  it('renders a heading for the kind in the human report', () => {
    const { report } = deriveDivergence(input());
    expect(renderDivergenceMarkdown(report)).toContain('Writes this deployment takes part in');
  });
});
