import { describe, expect, it } from 'vitest';
import {
  RETURN_COMMENT_ADDED_DEFAULT,
  RETURN_NEW_CASE_DEFAULT,
  RETURN_STATUS_ENTERED_DEFAULT,
  RETURN_SUBMITTED_DEFAULT,
} from './transactional-defaults.js';

/**
 * `specs/180-off-platform-complaints/` T017 (FR-A05, FR-A11, FR-A20, FR-A31, FR-A44;
 * contracts/settings-emails-events.md §2): the four new defaults, English and Polish,
 * naming only their declared variables.
 */
const DECLARED: Record<string, { defaults: typeof RETURN_NEW_CASE_DEFAULT; variables: string[] }> = {
  return_new_case: {
    defaults: RETURN_NEW_CASE_DEFAULT,
    variables: ['caseReference', 'kindLabel', 'customerName', 'organizationName', 'productList', 'offPlatform', 'submittedAt', 'adminCaseUrl'],
  },
  return_submitted: {
    defaults: RETURN_SUBMITTED_DEFAULT,
    variables: ['caseReference', 'kindLabel', 'productList', 'submittedAt', 'caseUrl'],
  },
  return_comment_added: { defaults: RETURN_COMMENT_ADDED_DEFAULT, variables: ['caseReference', 'commentBody', 'caseUrl'] },
  return_status_entered: { defaults: RETURN_STATUS_ENTERED_DEFAULT, variables: ['caseReference', 'statusName', 'caseUrl'] },
};

const LANGUAGES = ['en-US', 'pl-PL'];

/** Every `{{var x}}` and `{{if x}}` a text names. */
function namedVariables(text: string): Set<string> {
  return new Set([...text.matchAll(/\{\{(?:var|if)\s+([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!));
}

describe.each(Object.entries(DECLARED))('%s', (_code, { defaults, variables }) => {
  it('ships a subject and a body in en-US and pl-PL', () => {
    expect(Object.keys(defaults.defaultSubject).sort()).toEqual(LANGUAGES);
    const languages = (defaults.defaultContent as { languages: Record<string, unknown> }).languages;
    expect(Object.keys(languages).sort()).toEqual(LANGUAGES);
    expect(defaults.languages).toEqual(LANGUAGES);
  });

  it('names the case reference in every subject', () => {
    for (const language of LANGUAGES) {
      expect(defaults.defaultSubject[language]).toContain('{{var caseReference}}');
    }
  });

  it('names its declared variables and no other', () => {
    const text = JSON.stringify(defaults);
    for (const name of namedVariables(text)) expect(variables).toContain(name);
  });

  it('promises no processing time', () => {
    const text = JSON.stringify(defaults);
    expect(text).not.toMatch(/\b(within|in)\s+\d+\s*(business\s+)?(days?|hours?|working)/i);
    expect(text).not.toMatch(/w ciągu\s+\d+|w terminie\s+\d+|\d+\s+dni/i);
  });
});
