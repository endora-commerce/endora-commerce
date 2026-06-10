import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClarifyRequest, PromptActionRequestDto } from '@b2b/contracts';
import { ApiError } from '../api-client.js';
import {
  cancelPrompt,
  clarifyPrompt,
  confirmPrompt,
  getPromptRequest,
  submitPrompt,
} from './api.js';

/**
 * State machine behind the palette prompt mode (feature 043, research §R9):
 * submit → interpreting → (awaiting confirmation | clarification | terminal
 * message) → confirm → executing (with polling for delegated bulk work) →
 * result. Errors surface as non-technical, status-keyed messages the panel
 * localizes (FR-017).
 */

export type PromptPhase =
  | 'idle'
  | 'interpreting'
  | 'awaiting_confirmation'
  | 'needs_clarification'
  | 'executing'
  | 'finished'
  | 'request_error';

export interface PromptRequestState {
  phase: PromptPhase;
  request: PromptActionRequestDto | null;
  /** Error code from the API for request_error (e.g. PROMPT_PLAN_EXPIRED). */
  errorCode: string | null;
}

const POLL_INTERVAL_MS = 1_500;

function phaseFor(request: PromptActionRequestDto): PromptPhase {
  switch (request.status) {
    case 'awaiting_confirmation':
      return 'awaiting_confirmation';
    case 'needs_clarification':
      return 'needs_clarification';
    case 'executing':
      return 'executing';
    default:
      return 'finished';
  }
}

export interface UsePromptRequest extends PromptRequestState {
  submit: (prompt: string) => Promise<void>;
  clarify: (answer: ClarifyRequest) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  /** Load an existing request (FR-018 completion notice) into the panel. */
  load: (request: PromptActionRequestDto) => void;
}

export function usePromptRequest(): UsePromptRequest {
  const [state, setState] = useState<PromptRequestState>({
    phase: 'idle',
    request: null,
    errorCode: null,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback((): void => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const apply = useCallback(
    (request: PromptActionRequestDto): void => {
      setState({ phase: phaseFor(request), request, errorCode: null });
    },
    [],
  );

  const fail = useCallback((err: unknown): void => {
    const code = err instanceof ApiError ? (err.envelope.error.code ?? null) : null;
    setState((prev) => ({ ...prev, phase: 'request_error', errorCode: code }));
  }, []);

  // Poll delegated bulk executions until the request settles (FR-018/US2).
  useEffect(() => {
    if (state.phase !== 'executing' || !state.request) return;
    const id = state.request.id;
    pollRef.current = setInterval(() => {
      void getPromptRequest(id)
        .then((request) => {
          if (request.status !== 'executing') {
            stopPolling();
            apply(request);
          }
        })
        .catch(() => {
          /* transient poll failure — keep trying until close/reset */
        });
    }, POLL_INTERVAL_MS);
    return stopPolling;
  }, [state.phase, state.request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(
    async (prompt: string): Promise<void> => {
      setState({ phase: 'interpreting', request: null, errorCode: null });
      try {
        apply(await submitPrompt(prompt));
      } catch (err) {
        fail(err);
      }
    },
    [apply, fail],
  );

  const clarify = useCallback(
    async (answer: ClarifyRequest): Promise<void> => {
      const id = state.request?.id;
      if (!id) return;
      setState((prev) => ({ ...prev, phase: 'interpreting' }));
      try {
        apply(await clarifyPrompt(id, answer));
      } catch (err) {
        fail(err);
      }
    },
    [state.request?.id, apply, fail],
  );

  const confirm = useCallback(async (): Promise<void> => {
    const id = state.request?.id;
    if (!id) return;
    setState((prev) => ({ ...prev, phase: 'executing' }));
    try {
      apply(await confirmPrompt(id));
    } catch (err) {
      fail(err);
    }
  }, [state.request?.id, apply, fail]);

  const cancel = useCallback(async (): Promise<void> => {
    const id = state.request?.id;
    if (!id) {
      setState({ phase: 'idle', request: null, errorCode: null });
      return;
    }
    try {
      await cancelPrompt(id);
    } catch {
      /* already terminal — treated as cancelled locally */
    }
    setState({ phase: 'idle', request: null, errorCode: null });
  }, [state.request?.id]);

  const reset = useCallback((): void => {
    stopPolling();
    setState({ phase: 'idle', request: null, errorCode: null });
  }, [stopPolling]);

  const load = useCallback((request: PromptActionRequestDto): void => {
    setState({ phase: phaseFor(request), request, errorCode: null });
  }, []);

  return { ...state, submit, clarify, confirm, cancel, reset, load };
}
