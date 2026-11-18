import { describe, expect, it } from 'vitest';
import {
  RETURN_FORM_LIMITS,
  attachmentBudget,
  budgetLine,
  fileRefusal,
  formatBytes,
} from '../../lib/returns/attachments';

/**
 * `specs/180-off-platform-complaints/` T114 (FR-B20; design review R-2.5): the pure
 * attachment helpers the field and the route handler share.
 */
const MB = 1024 * 1024;

describe('fileRefusal', () => {
  it('accepts a JPEG, PNG, WebP or PDF of at most 10 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(fileRefusal({ name: 'a', size: 10 * MB, type }, RETURN_FORM_LIMITS)).toBeNull();
    }
  });

  it('refuses a larger file, and any other type', () => {
    expect(fileRefusal({ name: 'a', size: 10 * MB + 1, type: 'image/png' }, RETURN_FORM_LIMITS)).toBe('too_large');
    expect(fileRefusal({ name: 'a', size: 10, type: 'image/heic' }, RETURN_FORM_LIMITS)).toBe('type_not_accepted');
    expect(fileRefusal({ name: 'a', size: 10, type: 'text/html' }, RETURN_FORM_LIMITS)).toBe('type_not_accepted');
  });
});

describe('formatBytes', () => {
  it('formats in the locale, in KB below a megabyte and MB above', () => {
    expect(formatBytes(12.4 * MB, 'en-US')).toBe('12.4 MB');
    expect(formatBytes(12.4 * MB, 'pl-PL')).toBe('12,4 MB');
    expect(formatBytes(480 * 1024, 'en-US')).toBe('480 KB');
  });
});

describe('attachmentBudget and budgetLine', () => {
  it('counts files and bytes against the submission limits', () => {
    const budget = attachmentBudget([{ size: 4 * MB }, { size: 4.4 * MB }, { size: 4 * MB }], RETURN_FORM_LIMITS);
    expect(budget).toMatchObject({ count: 3, maxFiles: 10, full: false });
    expect(budgetLine(budget, 'en-US')).toBe('3 of 10 files · 12.4 of 30 MB');
    expect(budgetLine(budget, 'pl-PL')).toBe('3 z 10 plików · 12,4 z 30 MB');
  });

  it('is full at 10 files or 30 MB', () => {
    expect(attachmentBudget(Array.from({ length: 10 }, () => ({ size: 1 })), RETURN_FORM_LIMITS).full).toBe(true);
    expect(attachmentBudget([{ size: 30 * MB }], RETURN_FORM_LIMITS).full).toBe(true);
  });
});
