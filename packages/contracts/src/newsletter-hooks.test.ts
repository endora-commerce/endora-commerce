import { describe, expect, it } from 'vitest';
import { toHookableActionDeclaration } from './command-hooks.js';
import { NEWSLETTER_HOOKABLE_ACTIONS } from './newsletter-hooks.js';

describe('NEWSLETTER_HOOKABLE_ACTIONS (issue #1843)', () => {
  it('declares subscribe, resubscribe and confirm on the subscriber, for both phases', () => {
    expect(Object.values(NEWSLETTER_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      {
        action: 'newsletter_subscriber.subscribe',
        objectType: 'newsletter_subscriber',
        phases: ['beforeCommit', 'afterCommit'],
      },
      {
        action: 'newsletter_subscriber.resubscribe',
        objectType: 'newsletter_subscriber',
        phases: ['beforeCommit', 'afterCommit'],
      },
      {
        action: 'newsletter_subscriber.confirm',
        objectType: 'newsletter_subscriber',
        phases: ['beforeCommit', 'afterCommit'],
      },
    ]);
  });
});
