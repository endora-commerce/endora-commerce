import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PromptActionRequestDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * T048 — US2 interaction test: bulk preview renders affected count + sample
 * list; the result view renders the per-item failure breakdown; a finished
 * request opened from the completion notice is acknowledged (seen).
 */

const submitSpy = vi.fn();
const confirmSpy = vi.fn();
const seenSpy = vi.fn(async (_id: string) => undefined);

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'ready', bulkLimit: 500 })),
  submitPrompt: (...a: unknown[]) => submitSpy(...a),
  confirmPrompt: (...a: unknown[]) => confirmSpy(...a),
  cancelPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  listUnseenPromptRequests: vi.fn(async () => []),
  markPromptRequestSeen: (...a: unknown[]) => seenSpy(...(a as [string])),
}));

const { PromptModePanel } = await import(
  '../../../src/components/prompt-actions/PromptModePanel'
);

const BUNDLE = passthroughBundle('prompt_actions', [
  'panel.inputPlaceholder',
  'panel.submit',
  'panel.confirm',
  'panel.cancel',
  'panel.back',
  'panel.close',
  'panel.planHeading',
  'panel.affectedCount',
  'panel.sampleHeading',
  'panel.expiresHint',
  'panel.successWithErrors',
  'panel.resultSucceeded',
  'panel.resultFailed',
  'panel.success',
]);

function bulkRequest(): PromptActionRequestDto {
  return {
    id: '4f1a98c4-9a3f-4f7e-8c8e-1a2b3c4d5e6f',
    status: 'awaiting_confirmation',
    prompt: 'assign helmets',
    plan: {
      summary: 'Assign 12 product(s) to category "Helmets"',
      operations: [
        {
          toolId: 'catalog.assign_products_to_category',
          moduleId: 'catalog',
          params: { productIds: ['p1'], categoryId: 'c1' },
          requiredPermission: 'catalog:write',
          preview: {
            headline: 'Assign 12 product(s) to category "Helmets"',
            affectedCount: 12,
            sample: [
              { id: 'p1', label: 'Helmets pro 0' },
              { id: 'p2', label: 'Helmets pro 1' },
            ],
          },
        },
      ],
      bulkLimit: 500,
    },
    clarification: null,
    result: null,
    error: null,
    bulkOperationId: null,
    expiresAt: '2026-06-10T10:10:00.000Z',
    seenAt: null,
    createdAt: '2026-06-10T10:00:00.000Z',
  };
}

describe('PromptModePanel — US2 bulk journey (T048)', () => {
  beforeEach(() => {
    submitSpy.mockReset();
    confirmSpy.mockReset();
    seenSpy.mockClear();
  });

  it('renders the bulk preview: affected count + matched-sample list (US2/AC1)', async () => {
    const user = userEvent.setup();
    submitSpy.mockResolvedValue(bulkRequest());
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);

    await user.type(screen.getByTestId('prompt-input'), 'przypisz Helmets');
    await user.click(screen.getByRole('button', { name: 'panel.submit' }));

    await waitFor(() => screen.getByTestId('prompt-plan-preview'));
    expect(screen.getByText('Assign 12 product(s) to category "Helmets"')).toBeTruthy();
    expect(screen.getByText('panel.affectedCount')).toBeTruthy();
    expect(screen.getByText('Helmets pro 0')).toBeTruthy();
    expect(screen.getByText('Helmets pro 1')).toBeTruthy();
  });

  it('renders the per-item failure breakdown after a partial-failure run (US2/AC3)', async () => {
    const user = userEvent.setup();
    submitSpy.mockResolvedValue(bulkRequest());
    confirmSpy.mockResolvedValue({
      ...bulkRequest(),
      status: 'completed_with_errors',
      result: {
        outcome: 'completed_with_errors',
        operations: [
          {
            toolId: 'catalog.assign_products_to_category',
            status: 'succeeded',
            summary: {
              total: 12,
              succeeded: 11,
              failed: 1,
              failures: [{ id: 'p9', label: 'Helmets pro 9', reason: 'product_not_found' }],
            },
          },
        ],
      },
      expiresAt: null,
    });
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);

    await user.type(screen.getByTestId('prompt-input'), 'przypisz Helmets');
    await user.click(screen.getByRole('button', { name: 'panel.submit' }));
    await waitFor(() => screen.getByTestId('prompt-plan-preview'));
    await user.click(screen.getByRole('button', { name: 'panel.confirm' }));

    await waitFor(() => expect(screen.getByText('panel.successWithErrors')).toBeTruthy());
    const summary = screen.getByTestId('prompt-result-summary');
    expect(summary.textContent).toContain('panel.resultSucceeded');
    expect(summary.textContent).toContain('panel.resultFailed');
    expect(summary.textContent).toContain('Helmets pro 9: product_not_found');
  });

  it('a finished request opened from the completion notice is shown and acknowledged (FR-018)', async () => {
    const finished: PromptActionRequestDto = {
      ...bulkRequest(),
      status: 'completed',
      result: {
        outcome: 'completed',
        operations: [
          {
            toolId: 'catalog.assign_products_to_category',
            status: 'delegated',
            bulkOperationId: '9e09c8b6-0d3f-4f4e-8a8d-2b3c4d5e6f70',
            summary: { total: 60, succeeded: 60, failed: 0 },
          },
        ],
      },
      expiresAt: null,
    };
    renderWithI18n(<PromptModePanel onExit={vi.fn()} initialRequest={finished} />, BUNDLE);

    await waitFor(() => expect(screen.getByText('panel.success')).toBeTruthy());
    expect(screen.getByTestId('prompt-result-summary').textContent).toContain(
      'panel.resultSucceeded',
    );
    expect(seenSpy).toHaveBeenCalledWith(finished.id);
  });
});
