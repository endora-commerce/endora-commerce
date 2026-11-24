import { describe, expect, it } from 'vitest';
import { QUOTE_REQUEST_HOOKABLE_ACTIONS } from './quote-request-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';
import * as barrel from './index.js';

describe('QUOTE_REQUEST_HOOKABLE_ACTIONS (`specs/192-quote-request-draft-share/`)', () => {
  it('declares the share, before the commit only', () => {
    expect(Object.values(QUOTE_REQUEST_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'quote_request.share', objectType: 'quote_request', phases: ['beforeCommit'] },
    ]);
  });

  it('is published from the package barrel', () => {
    expect(barrel.QUOTE_REQUEST_HOOKABLE_ACTIONS).toBe(QUOTE_REQUEST_HOOKABLE_ACTIONS);
  });
});
