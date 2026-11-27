import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors.js';
import { ORGANIZATION_MERGE_ERROR_CODES } from './organizations.merge.js';
import { PROJECT_MERGE_ERROR_CODES } from './projects.merge.js';
import { RECORD_MERGE_ERROR_CODES } from './record-merge.js';

/**
 * `specs/192-organization-merge/` T004, data-model §6 — every merge error code
 * is a member of the platform's enumeration, so `check:error-translations`
 * (P1/P3) holds the declaring module's bundle to an `en` and a `pl` sentence
 * for it. The sentences themselves are that check's to judge, not this test's.
 */
describe('merge error codes', () => {
  it.each([
    ...Object.values(RECORD_MERGE_ERROR_CODES),
    ...Object.values(ORGANIZATION_MERGE_ERROR_CODES),
    ...Object.values(PROJECT_MERGE_ERROR_CODES),
  ])(
    '%s is in ERROR_CODES',
    (code) => {
      expect((ERROR_CODES as Record<string, string>)[code]).toBe(code);
    },
  );

  it('covers data-model §6 for the platform and the Organization host', () => {
    expect(Object.values(RECORD_MERGE_ERROR_CODES).sort()).toEqual([
      'RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED',
      'RECORD_MERGE_ALREADY_RUNNING',
      'RECORD_MERGE_BUSY',
      'RECORD_MERGE_IN_PROGRESS',
      'RECORD_MERGE_NOT_CANCELLABLE',
      'RECORD_MERGE_NOT_RESUMABLE',
      'RECORD_MERGE_PARTICIPANT_CONFLICT',
      'RECORD_MERGE_PARTICIPATION_INCOMPLETE',
      'RECORD_MERGE_RECORD_UNAVAILABLE',
      'RECORD_MERGE_RESIDUE',
      'RECORD_MERGE_SAME_RECORD',
    ]);
    expect(Object.values(ORGANIZATION_MERGE_ERROR_CODES).sort()).toEqual([
      'ORGANIZATION_MERGED',
      'ORGANIZATION_MERGE_PERSONAL',
      'ORGANIZATION_MERGE_TREE_INVALID',
    ]);
    // The Project host's codes: a write naming an archived Project (US6, OQ-6),
    // and a start that did not confirm the Organizations gaining access (FR-090).
    expect(Object.values(PROJECT_MERGE_ERROR_CODES).sort()).toEqual([
      'PROJECT_MERGED',
      'PROJECT_MERGE_ORGANIZATION_ACCESS_UNCONFIRMED',
    ]);
  });
});
