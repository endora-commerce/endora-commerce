import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { manifest } from '../../manifest.js';
import { OpportunityCommandService, type OpportunityCommandServiceDeps } from './opportunity-command-port.js';

/**
 * `specs/186-aggregate-ports/` research R-21.5 (issue #1827) — the port refuses
 * any `extensions` key itself, before anything is read, because no `crm`
 * action is declared hookable and a transition runs its guards and `.before`
 * events before its Command reaches the bus.
 *
 * **The guard below is what keeps that pre-check honest.** It holds the
 * manifest to declaring no hookable action. The change that declares the
 * first one fails it, and must in the same change remove the port's own
 * extensions refusal (`callerOf` in `opportunity-command-port.ts`) for that
 * action, so the bus — which then knows a claimant — decides instead. Do not
 * update this expectation without removing the pre-check.
 */
describe('opportunityCommandPort — the extensions pre-check (R-21.5)', () => {
  it('stands only while crm declares no hookable action', () => {
    expect(
      manifest.hookableActions ?? [],
      'crm now declares a hookable action: remove the extensions pre-check of opportunityCommandPort ' +
        '(callerOf in services/opportunity-command-port.ts) for it in this change (research R-21.5)',
    ).toEqual([]);
  });

  it('refuses a key with the bus’s code and details shape before any dependency is touched', async () => {
    const untouched = vi.fn(() => {
      throw new Error('a dependency was reached before the refusal');
    });
    const port = new OpportunityCommandService({
      emFactory: untouched,
      workflowRead: { loadGraph: untouched },
      opportunities: untouched,
      assignment: untouched,
      transitions: untouched,
      links: untouched,
      comments: untouched,
      records: { findById: untouched },
    } as unknown as OpportunityCommandServiceDeps);

    await expect(
      port.transition('00000000-0000-4000-8000-000000000001', { to: 'qualified' }, { extensions: { nobody: {} } }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.nobody', issue: expect.any(String) }],
    });
    expect(untouched).not.toHaveBeenCalled();
  });
});
