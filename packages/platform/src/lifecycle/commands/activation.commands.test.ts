import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMISSION_EXEMPT_ACTIONS } from '../../commands/command-bus.js';
import { registryCache } from '../../kernel/lifecycle/registry-cache.js';
import * as gating from '../services/gating-graph.js';
import { makeSetActivationCommand } from './activation.commands.js';

/**
 * `specs/189-command-middleware/` T014 (FR-014, research R-14): the Command
 * Bus exempts the operator's activation switch from `admit`, so a rule that
 * refuses everything cannot lock the operator out of the switch that removes
 * it. The exemption names an action by string; this holds it to the action
 * the activation Command actually runs, so a rename cannot leave it stale.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ADMISSION_EXEMPT_ACTIONS (189 T014)', () => {
  it('names the action of the activation Command, and nothing else', () => {
    vi.spyOn(registryCache, 'activationDeclaration').mockReturnValue({
      settingCode: 'acme_hold.activation',
      default: true,
    } as never);
    vi.spyOn(gating, 'gatingGraph').mockReturnValue({
      presentDependentsOf: () => [],
      absentDependenciesOf: () => [],
    } as never);
    const command = makeSetActivationCommand({ moduleId: 'acme_hold', active: false });
    expect(ADMISSION_EXEMPT_ACTIONS).toEqual([command.action]);
  });
});
