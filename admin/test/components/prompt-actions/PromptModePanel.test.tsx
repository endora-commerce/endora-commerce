import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PromptActionRequestDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * T040 — US1 interaction test for the palette prompt mode: the plan renders
 * resolved entities + the current value, confirm reports success, cancel
 * makes no confirm call and preserves the typed prompt.
 */

const submitSpy = vi.fn();
const confirmSpy = vi.fn();
const cancelSpy = vi.fn();

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'ready', bulkLimit: 500 })),
  submitPrompt: (...a: unknown[]) => submitSpy(...a),
  confirmPrompt: (...a: unknown[]) => confirmSpy(...a),
  cancelPrompt: (...a: unknown[]) => cancelSpy(...a),
  clarifyPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  listUnseenPromptRequests: vi.fn(async () => []),
  markPromptRequestSeen: vi.fn(),
}));

const { PromptModePanel } = await import(
  '../../../src/components/prompt-actions/PromptModePanel'
);

const BUNDLE = passthroughBundle('prompt_actions', [
  'panel.inputPlaceholder',
  'panel.submit',
  'panel.interpreting',
  'panel.executing',
  'panel.confirm',
  'panel.cancel',
  'panel.back',
  'panel.close',
  'panel.planHeading',
  'panel.affectedCount',
  'panel.sampleHeading',
  'panel.currentValue',
  'panel.expiresHint',
  'panel.success',
  'panel.resultSucceeded',
]);

function awaitingRequest(): PromptActionRequestDto {
  return {
    id: '0a3c0c46-1b7e-4a44-9b87-6a3a5ab8f001',
    status: 'awaiting_confirmation',
    prompt: 'set stock to 120',
    plan: {
      summary: 'Set stock of "Bolts 0193" in warehouse "Default" to 120',
      operations: [
        {
          toolId: 'inventory.set_stock_level',
          moduleId: 'inventory',
          params: { productId: 'p1', warehouseId: 'w1', quantity: 120 },
          requiredPermission: 'catalog:write',
          preview: {
            headline: 'Set stock of "Bolts 0193" in warehouse "Default" to 120',
            current: { onHand: 80 },
            affectedCount: 1,
            sample: [{ id: 'p1', label: 'Bolts 0193' }],
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

describe('PromptModePanel — US1 journey (T040)', () => {
  beforeEach(() => {
    submitSpy.mockReset();
    confirmSpy.mockReset();
    cancelSpy.mockReset();
  });

  it('submits the prompt and renders the server-computed plan (resolved entities + current value)', async () => {
    const user = userEvent.setup();
    submitSpy.mockResolvedValue(awaitingRequest());
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);

    await user.type(
      screen.getByTestId('prompt-input'),
      'Dla produktu Bolts 0193 ustaw stan na 120',
    );
    await user.click(screen.getByRole('button', { name: 'panel.submit' }));

    await waitFor(() => expect(screen.getByTestId('prompt-plan-preview')).toBeTruthy());
    expect(submitSpy).toHaveBeenCalledWith('Dla produktu Bolts 0193 ustaw stan na 120');
    expect(
      screen.getByText('Set stock of "Bolts 0193" in warehouse "Default" to 120'),
    ).toBeTruthy();
    // Current value shown before anything changes (US1/AC2).
    expect(screen.getByText(/"onHand":80/)).toBeTruthy();
  });

  it('confirm executes and reports success', async () => {
    const user = userEvent.setup();
    submitSpy.mockResolvedValue(awaitingRequest());
    confirmSpy.mockResolvedValue({
      ...awaitingRequest(),
      status: 'completed',
      result: {
        outcome: 'completed',
        operations: [{ toolId: 'inventory.set_stock_level', status: 'succeeded' }],
      },
      expiresAt: null,
    });
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);

    await user.type(screen.getByTestId('prompt-input'), 'set stock');
    await user.click(screen.getByRole('button', { name: 'panel.submit' }));
    await waitFor(() => screen.getByTestId('prompt-plan-preview'));
    await user.click(screen.getByRole('button', { name: 'panel.confirm' }));

    await waitFor(() => expect(screen.getByText('panel.success')).toBeTruthy());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('prompt-result-summary').textContent).toContain(
      'panel.resultSucceeded',
    );
  });

  it('cancel never confirms and preserves the typed prompt (US1/AC3)', async () => {
    const user = userEvent.setup();
    submitSpy.mockResolvedValue(awaitingRequest());
    cancelSpy.mockResolvedValue({ ...awaitingRequest(), status: 'cancelled' });
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);

    const input = screen.getByTestId('prompt-input') as HTMLInputElement;
    await user.type(input, 'ustaw stan na 120');
    await user.click(screen.getByRole('button', { name: 'panel.submit' }));
    await waitFor(() => screen.getByTestId('prompt-plan-preview'));

    await user.click(screen.getByRole('button', { name: 'panel.cancel' }));
    await waitFor(() => expect(screen.queryByTestId('prompt-plan-preview')).toBeNull());

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    // Input is editable again with the original text preserved.
    expect(input.value).toBe('ustaw stan na 120');
    expect(input.disabled).toBe(false);
  });
});
