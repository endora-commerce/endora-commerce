import { describe, expect, it } from 'vitest';
import { QUOTE_REQUEST_HOOKABLE_ACTIONS } from './quote-request-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';

describe('QUOTE_REQUEST_HOOKABLE_ACTIONS (issue #1906)', () => {
  it("declares the buyer's create-and-submit and submit-again for both phases, and nothing else", () => {
    expect(Object.values(QUOTE_REQUEST_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'quote_request.create', objectType: 'quote_request', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'quote_request.resubmit', objectType: 'quote_request', phases: ['beforeCommit', 'afterCommit'] },
    ]);
  });
});
