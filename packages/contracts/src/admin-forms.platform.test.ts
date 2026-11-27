import { describe, expect, it } from 'vitest';
import {
  FIELD_WRITE_FORBIDDEN_REASONS,
  FieldSlotInputInvalidDetailSchema,
  FieldWriteForbiddenDetailSchema,
} from './admin-forms.js';
import { ERROR_CODES } from './errors.js';

/**
 * `specs/193-admin-form-extensions/` WP-B (T026, T027) — what the platform's
 * field-rule check and `fieldSlotHook` answer with, as the contracts state it:
 * the three error codes, the `403 FIELD_WRITE_FORBIDDEN` detail and its
 * reasons, and the `422 FIELD_SLOT_INPUT_INVALID` detail.
 */

describe('field-rule error codes (193 T027, field-rules.md §5)', () => {
  it('enumerates the three platform codes', () => {
    expect(ERROR_CODES.FIELD_RULE_VIOLATION).toBe('FIELD_RULE_VIOLATION');
    expect(ERROR_CODES.FIELD_WRITE_FORBIDDEN).toBe('FIELD_WRITE_FORBIDDEN');
    expect(ERROR_CODES.FIELD_SLOT_INPUT_INVALID).toBe('FIELD_SLOT_INPUT_INVALID');
  });
});

describe('FieldWriteForbiddenDetailSchema (193 T026, research R-12)', () => {
  it('names the two reasons, additive-only', () => {
    expect(FIELD_WRITE_FORBIDDEN_REASONS).toEqual(['missing-permission', 'api-key-scopes-unresolved']);
  });

  it('accepts one entry per forbidden field', () => {
    for (const reason of FIELD_WRITE_FORBIDDEN_REASONS) {
      expect(
        FieldWriteForbiddenDetailSchema.safeParse({ path: 'emails', permission: 'organizations:emails', reason, message: 'No.' })
          .success,
      ).toBe(true);
    }
    expect(
      FieldWriteForbiddenDetailSchema.safeParse({ path: 'extensions.acme_erp.code', permission: 'acme_erp:write', reason: 'missing-permission', message: 'No.' })
        .success,
    ).toBe(true);
  });

  it('refuses an unknown reason or a missing permission', () => {
    expect(FieldWriteForbiddenDetailSchema.safeParse({ path: 'emails', permission: 'x', reason: 'nope', message: 'No.' }).success).toBe(false);
    expect(FieldWriteForbiddenDetailSchema.safeParse({ path: 'emails', reason: 'missing-permission', message: 'No.' }).success).toBe(false);
  });
});

describe('FieldSlotInputInvalidDetailSchema (193 T022, field-slots.md §4)', () => {
  it('carries the path under extensions.<moduleId> and the issue', () => {
    expect(FieldSlotInputInvalidDetailSchema.safeParse({ path: 'extensions.acme_erp.code', issue: 'Too long' }).success).toBe(true);
    expect(FieldSlotInputInvalidDetailSchema.safeParse({ path: 'code', issue: 'Too long' }).success).toBe(false);
  });
});
