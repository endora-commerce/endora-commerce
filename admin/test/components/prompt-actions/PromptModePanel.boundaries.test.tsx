import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PromptActionRequestDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { ApiError } from '@/lib/api-client';

/**
 * T053 — US3 interaction test: clarification candidate picker + free-text
 * input, unsupported / refused / provider-failure message states — all
 * non-technical (FR-017).
 */

const submitSpy = vi.fn();
const clarifySpy = vi.fn();

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'ready', bulkLimit: 500 })),
  submitPrompt: (...a: unknown[]) => submitSpy(...a),
  clarifyPrompt: (...a: unknown[]) => clarifySpy(...(a as [string, unknown])),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
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
  'panel.back',
  'panel.close',
  'panel.cancel',
  'panel.clarificationHeading',
  'panel.clarificationFreeTextPlaceholder',
  'panel.clarificationSubmit',
  'panel.unsupported',
  'panel.refused',
  'panel.failed',
  'panel.providerError',
  'panel.planExpired',
]);

function base(status: PromptActionRequestDto['status']): PromptActionRequestDto {
  return {
    id: '5b2c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
    status,
    prompt: 'x',
    plan: null,
    clarification: null,
    result: null,
    error: null,
    bulkOperationId: null,
    expiresAt: null,
    seenAt: null,
    createdAt: '2026-06-10T10:00:00.000Z',
  };
}

async function typeAndSubmit(text = 'zwiększ stan Bolts'): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('prompt-input'), text);
  await user.click(screen.getByRole('button', { name: 'panel.submit' }));
}

describe('PromptModePanel — US3 boundaries (T053)', () => {
  beforeEach(() => {
    submitSpy.mockReset();
    clarifySpy.mockReset();
  });

  it('renders the candidate picker and answers with the chosen id (US3/AC1)', async () => {
    submitSpy.mockResolvedValue({
      ...base('needs_clarification'),
      clarification: {
        question: 'Which product did you mean?',
        kind: 'entity_choice',
        candidates: [
          { id: 'p1', label: 'Bolts 0193', hint: 'SKU B-0193' },
          { id: 'p2', label: 'Bolts 0200' },
        ],
      },
    });
    clarifySpy.mockResolvedValue(base('unsupported'));
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);
    await typeAndSubmit();

    await waitFor(() => screen.getByTestId('prompt-clarification'));
    expect(screen.getByText('Which product did you mean?')).toBeTruthy();
    expect(screen.getByText('Bolts 0200')).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByText('Bolts 0193'));
    await waitFor(() =>
      expect(clarifySpy).toHaveBeenCalledWith(base('x' as never).id, {
        selectedCandidateId: 'p1',
      }),
    );
  });

  it('renders the free-text clarification input and submits the answer', async () => {
    submitSpy.mockResolvedValue({
      ...base('needs_clarification'),
      clarification: { question: 'Which warehouse?', kind: 'free_text' },
    });
    clarifySpy.mockResolvedValue(base('unsupported'));
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);
    await typeAndSubmit();

    await waitFor(() => screen.getByTestId('prompt-clarification-text'));
    const user = userEvent.setup();
    await user.type(screen.getByTestId('prompt-clarification-text'), 'the Default one');
    await user.click(screen.getByRole('button', { name: 'panel.clarificationSubmit' }));
    await waitFor(() =>
      expect(clarifySpy).toHaveBeenCalledWith(expect.any(String), { text: 'the Default one' }),
    );
  });

  it('shows the unsupported and refused states as plain messages', async () => {
    submitSpy.mockResolvedValueOnce(base('unsupported'));
    const first = renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);
    await typeAndSubmit('wyślij newsletter');
    await waitFor(() => expect(screen.getByText('panel.unsupported')).toBeTruthy());
    first.unmount();

    submitSpy.mockResolvedValueOnce(base('refused'));
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);
    await typeAndSubmit('ustaw stan');
    await waitFor(() => expect(screen.getByText('panel.refused')).toBeTruthy());
  });

  it('maps API failures to the non-technical provider-error message (FR-017)', async () => {
    submitSpy.mockRejectedValue(
      new ApiError(500, {
        error: { code: 'INTERNAL', message: 'boom' },
      } as never),
    );
    renderWithI18n(<PromptModePanel onExit={vi.fn()} />, BUNDLE);
    await typeAndSubmit();
    await waitFor(() => expect(screen.getByText('panel.providerError')).toBeTruthy());
    // No stack traces / raw provider text reaches the operator.
    expect(screen.queryByText(/boom/)).toBeNull();
  });
});
