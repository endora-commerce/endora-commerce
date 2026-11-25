import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { OpportunityStatusGraph } from '../domain/opportunity-status-graph.js';
import { OpportunityReadPortService } from './opportunity-read-port.js';
import type { WorkflowReadService } from './workflow-read-service.js';

/**
 * Issue #455 — `crm` names an Opportunity status for another module by its own
 * rule (`resolveOpportunityStatusName`): the operator's name in the language
 * asked for, then the default name, then the code.
 */
function port() {
  const graph = new OpportunityStatusGraph(
    [
      {
        code: 'proposal',
        name: { en: 'Proposal', pl: 'Propozycja' },
        defaultName: 'Proposal sent',
        kind: 'open',
        isInitial: true,
        weight: 1,
        color: '#000000',
      },
      { code: 'won', name: {}, defaultName: 'Won', kind: 'won', isInitial: false, weight: 2, color: '#000000' },
    ],
    [],
  );
  const workflowRead = { loadGraph: vi.fn(async () => graph) } as unknown as WorkflowReadService;
  return new OpportunityReadPortService((() => ({})) as unknown as () => EntityManager, workflowRead, () => ({
    listNotes: vi.fn(),
  }));
}

describe('OpportunityReadPort.statusName (issue #455)', () => {
  it('answers the configured name in the language asked for', async () => {
    expect(await port().statusName('proposal', 'pl')).toBe('Propozycja');
    expect(await port().statusName('proposal', 'en')).toBe('Proposal');
  });

  it('falls back to the default name, then to the code', async () => {
    expect(await port().statusName('won', 'pl')).toBe('Won');
    expect(await port().statusName('gone', 'pl')).toBe('gone');
  });
});
