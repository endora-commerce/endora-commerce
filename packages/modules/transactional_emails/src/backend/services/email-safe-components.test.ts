import { describe, expect, it } from 'vitest';

import { emailSafeNamesFrom, unknownEmailComponents } from './email-safe-components.js';

/**
 * `specs/141-module-block-renderers/` US3 — an e-mail that contains a module's
 * contributed block has to be **saveable**. Save-time validation used to hold
 * content to the closed list `email-components` renders itself, so a block any
 * other module declared for `email` was refused before it could ever be sent.
 * Found by the acceptance criterion, not by a unit test.
 */

const tree = (...types: string[]): unknown => ({
  root: { props: {} },
  content: types.map((type, index) => ({ type, props: { id: `n${String(index)}` } })),
  zones: {},
});

const manifests = [
  { id: 'crm', blocks: [{ name: 'crm.Badge', contexts: ['cms', 'email'] }] },
  { id: 'cms', blocks: [{ name: 'cms.Text', contexts: ['cms'] }] },
  { id: 'plain' },
];

describe('emailSafeNamesFrom', () => {
  it('admits the first-party set, every block a manifest declares for email, and every registered renderer', () => {
    const names = emailSafeNamesFrom(manifests, () => ['overlay_crm.Banner'])();
    expect(names.has('transactional_emails.EmailText')).toBe(true);
    expect(names.has('crm.Badge')).toBe(true);
    expect(names.has('overlay_crm.Banner')).toBe(true);
    // Declared, but not for e-mail.
    expect(names.has('cms.Text')).toBe(false);
  });

  it('reads the registered renderers on every call, so a late registration is admitted', () => {
    const registered: string[] = [];
    const names = emailSafeNamesFrom([], () => registered);
    expect(names().has('late.Block')).toBe(false);
    registered.push('late.Block');
    expect(names().has('late.Block')).toBe(true);
  });
});

describe('unknownEmailComponents', () => {
  const names = emailSafeNamesFrom(manifests)();

  it('accepts content holding a declared module block', () => {
    expect(unknownEmailComponents(tree('transactional_emails.EmailText', 'crm.Badge'), names)).toEqual([]);
  });

  it('still refuses a block nobody declares for email', () => {
    expect(unknownEmailComponents(tree('cms.Text', 'nobody.Block'), names).sort()).toEqual([
      'cms.Text',
      'nobody.Block',
    ]);
  });
});
