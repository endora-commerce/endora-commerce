import { describe, expect, it } from 'vitest';
import { QUOTE_REQUEST_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';

/**
 * `specs/192-quote-request-draft-share/` T024 (`contracts/share-hook.md` §1) —
 * the module declares the share hookable, before the commit only, so another
 * module may refuse it.
 */
describe('quote_requests manifest — hookable actions', () => {
  it('declares quote_request.share for beforeCommit only', () => {
    expect(manifest.hookableActions).toEqual([
      { action: QUOTE_REQUEST_HOOKABLE_ACTIONS.share.action, objectType: 'quote_request', phases: ['beforeCommit'] },
    ]);
  });
});
