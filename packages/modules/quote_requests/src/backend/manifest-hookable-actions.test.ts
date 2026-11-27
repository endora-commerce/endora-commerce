import { describe, expect, it } from 'vitest';
import { QUOTE_REQUEST_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';

/**
 * `specs/192-quote-request-draft-share/` T024 (`contracts/share-hook.md` §1) —
 * the module declares the share hookable, before the commit only, so another
 * module may refuse it; beside the buyer's create and resubmit (issue #1906,
 * `commands/quote-request-create-hooks.test.ts`).
 */
describe('quote_requests manifest — hookable actions', () => {
  it('declares quote_request.share for beforeCommit only, beside the buyer’s create and resubmit', () => {
    expect(manifest.hookableActions).toEqual([
      { action: QUOTE_REQUEST_HOOKABLE_ACTIONS.create.action, objectType: 'quote_request', phases: ['beforeCommit', 'afterCommit'] },
      { action: QUOTE_REQUEST_HOOKABLE_ACTIONS.resubmit.action, objectType: 'quote_request', phases: ['beforeCommit', 'afterCommit'] },
      { action: QUOTE_REQUEST_HOOKABLE_ACTIONS.share.action, objectType: 'quote_request', phases: ['beforeCommit'] },
    ]);
  });
});
